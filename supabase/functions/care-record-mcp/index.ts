import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0';
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@^1.6.0';
import { z } from 'npm:zod@^4.3.6';
import formTemplate from '../_shared/default-form-template.json' with { type: 'json' };
import { buildClarificationQuestions } from '../_shared/clarify-candidate.ts';
import { normalizeDate, normalizeTime, normalizeValues, type FormItem } from '../_shared/validate-candidate.ts';

const template = formTemplate as FormItem[];
const uuid = z.uuid();
const shortText = z.string().max(255);
const optionalReadText = z.string().max(255).nullable();
const recordInput = z.object({
  meta: z.object({
    date: optionalReadText,
    start_at: optionalReadText,
    end_at: optionalReadText,
    client_name: optionalReadText,
    helper_names: z.array(z.string().max(255)).max(10),
    travel_time_hours: z.number().min(0).max(24).nullable().optional(),
  }),
  values: z.record(z.string().max(100), z.unknown()),
  confidence: z.enum(['high', 'medium', 'low']).default('medium'),
  warnings: z.array(z.string().max(300)).max(30).default([]),
});

const appOrigin = Deno.env.get('APP_ORIGIN')?.replace(/\/$/, '');

Deno.serve(withOAuthProtectedResource(withSupabase({ auth: 'user' }, async (request, { supabase }) => {
  const handler = createMcpHandler(() => {
    const server = new McpServer(
      { name: 'care-record-import', version: '0.1.0' },
      {
        instructions: '添付PDFはAIクライアント側で読み取ってください。このサーバーはOCRを実行しません。事業所とフォームを取得し、フォームの項目名・選択肢を先に確認してください。不明な値を推測せず、submit_record_candidate が返す質問を利用者に選択肢と自由記入で尋ねてから再送信してください。利用者が「このまま送信」を選んだ場合は send_anyway=true で送信できます。送信後は管理者が原本と照合します。',
      },
    );

    server.registerTool('list_workspaces', {
      title: '取込先の事業所を確認',
      description: 'サインイン中の利用者が所属する事業所を一覧し、AI読み取り候補の取込先を選びます。',
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }, async () => {
      const { data, error } = await supabase.rpc('list_mcp_workspaces');
      if (error) throw new Error('事業所を取得できませんでした');
      const workspaces = (data ?? []).map((item: { id: string; name: string }) => ({ id: item.id, name: item.name }));
      return { structuredContent: { workspaces }, content: [{ type: 'text', text: JSON.stringify({ workspaces }) }] };
    });

    server.registerTool('get_record_form', {
      title: 'サービス提供記録のフォームを取得',
      description: '紙の記録を読み取る前に、取込先アプリのフィールドID・選択肢を取得します。',
      inputSchema: z.object({ organization_id: uuid }),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }, async ({ organization_id }) => {
      const { data, error } = await supabase.rpc('list_mcp_workspaces');
      if (error || !(data ?? []).some((item: { id: string }) => item.id === organization_id)) {
        throw new Error('この事業所へのアクセス権がありません');
      }
      const { data: selfStaffNames, error: staffError } = await supabase.rpc('get_mcp_self_staff_names', {
        p_organization_id: organization_id,
      });
      if (staffError) throw new Error('本人のスタッフ名を取得できませんでした');
      const output = {
        form: template,
        self_staff_names: selfStaffNames ?? [],
        expected_inputs: template.filter((item) => item.type !== 'section').map((item) => ({
          id: item.id,
          label: item.label,
          type: item.type,
          options: (item.options ?? '').split(',').map((option) => option.trim()).filter(Boolean),
        })),
        rules: [
          '手書きのチェックと丸印だけを選択し、印刷された選択肢を推測で選ばない',
          '左端のチェックと行内の丸印を別々に判定する',
          '令和N年は2018+N年として西暦へ変換する',
          '紙面の移動(加算)はmeta.travel_time_hoursに時間単位で入れる',
          'self_staff_namesは接続した本人の名前のヒントであり、紙面に別の担当者があれば紙面を優先する',
          '特記事項は原文のみ転記し、判読不能なら空欄と警告にする',
          '読めない箇所は利用者に選択肢と自由記入で質問し、回答がなければ警告を残して送信できる',
          '送信された記録は管理者の確認待ちとなり、管理者が原本と照合して承認する',
        ],
      };
      return { structuredContent: output, content: [{ type: 'text', text: JSON.stringify(output) }] };
    });

    server.registerTool('submit_record_candidate', {
      title: 'AI読み取り記録を管理者へ送信',
      description: '紙/PDFの読み取り結果を管理者の確認待ちへ送信します。不明な項目は推測せずnullまたは省略し、warningsに記載してください。質問が返った場合は選択肢と自由記入で利用者に尋ね、回答を反映して再実行してください。利用者がこのまま送信を望む場合のみsend_anyway=trueを指定します。',
      inputSchema: z.object({
        organization_id: uuid,
        source_file_name: shortText.optional(),
        record: recordInput,
        send_anyway: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    }, async ({ organization_id, source_file_name, record, send_anyway }) => {
      const warnings = [...record.warnings];
      const payload = {
        meta: {
          date: normalizeDate(record.meta.date, warnings),
          start_at: normalizeTime(record.meta.start_at, '開始時刻', warnings),
          end_at: normalizeTime(record.meta.end_at, '終了時刻', warnings),
          client_name: record.meta.client_name,
          helper_names: record.meta.helper_names,
          client_id_candidate: null,
          helper_id_candidates: [],
          travel_time_hours: record.meta.travel_time_hours ?? null,
        },
        values: normalizeValues(record.values, template, warnings),
        confidence: record.confidence,
        warnings: [...new Set(warnings)].slice(0, 50),
      };
      const questions = buildClarificationQuestions(record, payload.warnings, template);
      if (questions.length > 0 && !send_anyway) {
        const result = {
          status: 'needs_clarification',
          questions,
          message: '読めなかった箇所を利用者に確認してください。各質問は選択肢と自由記入を受け付けます。「このまま送信」も選べます。',
        };
        return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
      }
      if (JSON.stringify(payload).length > 100000) throw new Error('読み取り結果が大きすぎます');
      const { data, error } = await supabase.rpc('submit_mcp_candidate', {
        p_organization_id: organization_id,
        p_source_file_name: source_file_name ?? '',
        p_payload: payload,
      });
      if (error || !data) throw new Error('候補を登録できませんでした。取込先と権限を確認してください');
      const result = {
        candidate_id: data,
        status: 'submitted',
        review_url: appOrigin ? `${appOrigin}/app/ai-candidates` : null,
        message: 'AI読み取り記録を送信しました。管理者の確認待ちです。',
      };
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    });

    return server;
  });
  return handler.fetch(request);
})));
