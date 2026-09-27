import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0';
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@^1.6.0';
import { z } from 'npm:zod@^4.3.6';
import formTemplate from '../_shared/default-form-template.json' with { type: 'json' };
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
        instructions: '添付PDFはAIクライアント側で読み取ってください。このサーバーはOCRを実行しません。事業所とフォームを取得してから読み取り候補を送信します。不明な値は推測せず空欄と警告にし、候補は必ずアプリで原本照合してください。',
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
      const output = {
        form: template,
        rules: [
          '手書きのチェックと丸印だけを選択し、印刷された選択肢を推測で選ばない',
          '左端のチェックと行内の丸印を別々に判定する',
          '令和N年は2018+N年として西暦へ変換する',
          '紙面の移動(加算)はmeta.travel_time_hoursに時間単位で入れる',
          '特記事項は原文のみ転記し、判読不能なら空欄と警告にする',
          'AIの結果は候補であり、アプリで原本を確認するまで記録として確定しない',
        ],
      };
      return { structuredContent: output, content: [{ type: 'text', text: JSON.stringify(output) }] };
    });

    server.registerTool('submit_record_candidate', {
      title: 'AI読み取り候補を確認待ちに送る',
      description: '利用者が提供した紙/PDFをAIクライアントが読んだ結果を、アプリの要確認候補に登録します。記録本体への保存や確定は行いません。不明な項目は推測せずnullまたは省略し、warningsに記載してください。',
      inputSchema: z.object({
        organization_id: uuid,
        source_file_name: shortText.optional(),
        record: recordInput,
      }),
      annotations: { readOnlyHint: false, openWorldHint: false, destructiveHint: false },
    }, async ({ organization_id, source_file_name, record }) => {
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
      if (JSON.stringify(payload).length > 100000) throw new Error('読み取り結果が大きすぎます');
      const { data, error } = await supabase.rpc('submit_mcp_candidate', {
        p_organization_id: organization_id,
        p_source_file_name: source_file_name ?? '',
        p_payload: payload,
      });
      if (error || !data) throw new Error('候補を登録できませんでした。取込先と権限を確認してください');
      const result = {
        candidate_id: data,
        status: 'needs_review',
        review_url: appOrigin ? `${appOrigin}/app/ai-candidates` : null,
        message: 'AI読み取り候補を登録しました。アプリで原本と照合し、必要な修正をしてから下書き保存してください。',
      };
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    });

    return server;
  });
  return handler.fetch(request);
})));
