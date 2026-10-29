import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { createMcpHandler, McpServer } from 'npm:@modelcontextprotocol/server@^2.0.0';
import { withOAuthProtectedResource, withSupabase } from 'npm:@supabase/server@^1.6.0';
import { z } from 'npm:zod@^4.3.6';
import formTemplate from '../_shared/default-form-template.json' with { type: 'json' };
import { buildClarificationQuestions } from '../_shared/clarify-candidate.ts';
import { normalizeDate, normalizeTime, normalizeValues, type FormItem } from '../_shared/validate-candidate.ts';
import { checkRecordQuality } from '../_shared/record-quality.ts';
import { observeMcpTool } from '../_shared/mcp-observability.ts';

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
const connectionError = '処理できませんでした。接続状態を確認し、必要なら再接続してください。';

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
    }, async () => observeMcpTool('list_workspaces', async () => {
      const { data, error } = await supabase.rpc('list_mcp_workspaces');
      if (error) throw new Error(connectionError);
      const workspaces = (data ?? []).map((item: { id: string; name: string }) => ({ id: item.id, name: item.name }));
      return { structuredContent: { workspaces }, content: [{ type: 'text', text: JSON.stringify({ workspaces }) }] };
    }));

    server.registerTool('get_record_form', {
      title: 'サービス提供記録のフォームを取得',
      description: '紙の記録を読み取る前に、取込先アプリのフィールドID・選択肢を取得します。',
      inputSchema: z.object({ organization_id: uuid }),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }, async ({ organization_id }) => observeMcpTool('get_record_form', async () => {
      const { data, error } = await supabase.rpc('list_mcp_workspaces');
      if (error) throw new Error(connectionError);
      if (!(data ?? []).some((item: { id: string }) => item.id === organization_id)) {
        throw new Error('この事業所へのアクセス権がありません');
      }
      const { data: selfStaffNames, error: staffError } = await supabase.rpc('get_mcp_self_staff_names', {
        p_organization_id: organization_id,
      });
      if (staffError) throw new Error(connectionError);
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
    }));

    server.registerTool('search_people', {
      title: 'スタッフ・利用者を検索',
      description: '事業所内の権限のある候補を名前で検索します。同名など複数候補がある場合は登録日とIDを示し、利用者に選択を求めてください。推測して確定しないでください。',
      inputSchema: z.object({ organization_id: uuid, kind: z.enum(['client', 'staff']), name: z.string().trim().min(1).max(100), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(10000).default(0) }),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }, async (args) => observeMcpTool('search_people', async () => {
      const { data, error } = await supabase.rpc('search_mcp_people', { p_organization_id: args.organization_id, p_kind: args.kind, p_name: args.name, p_limit: args.limit, p_offset: args.offset });
      if (error) throw new Error(connectionError);
      return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
    }));

    server.registerTool('list_records', {
      title: '提供記録を検索',
      description: 'JSTの日付と確認済みの利用者・担当者ID、状態で権限内の記録を検索します。本文は詳細で確認します。',
      inputSchema: z.object({ organization_id: uuid, start_date: z.iso.date(), end_date: z.iso.date(), client_id: uuid.optional(), staff_id: uuid.optional(), status: z.enum(['draft', 'pending', 'approved', 'remanded']).optional(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(10000).default(0) }),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }, async (args) => observeMcpTool('list_records', async () => {
      const { data, error } = await supabase.rpc('list_mcp_records', { p_organization_id: args.organization_id, p_start: args.start_date, p_end: args.end_date, p_client_id: args.client_id ?? null, p_staff_id: args.staff_id ?? null, p_status: args.status ?? null, p_limit: args.limit, p_offset: args.offset });
      if (error) throw new Error(connectionError);
      return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
    }));

    server.registerTool('list_approval_queue', {
      title: '未承認・差戻しの記録を確認',
      description: 'JSTのサービス日で未承認・差戻しの件数と権限内の記録を参照します。状態別件数は状態フィルタにかかわらず期間全体の件数です。承認や差戻しは実行しません。',
      inputSchema: z.object({ organization_id: uuid, start_date: z.iso.date(), end_date: z.iso.date(), status: z.enum(['pending', 'remanded']).optional(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(10000).default(0) }),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }, async (args) => observeMcpTool('list_approval_queue', async () => {
      const { data, error } = await supabase.rpc('list_mcp_approval_queue', { p_organization_id: args.organization_id, p_start: args.start_date, p_end: args.end_date, p_status: args.status ?? null, p_limit: args.limit, p_offset: args.offset });
      if (error) throw new Error(connectionError);
      return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
    }));

    server.registerTool('get_record', {
      title: '提供記録の詳細を取得',
      description: '確認済みの記録IDから権限内の本文・承認状態・版を取得します。添付ファイルは提供しません。',
      inputSchema: z.object({ organization_id: uuid, record_id: uuid }),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }, async ({ organization_id, record_id }) => observeMcpTool('get_record', async () => {
      const { data, error } = await supabase.rpc('get_mcp_record', { p_organization_id: organization_id, p_record_id: record_id });
      if (error) throw new Error(connectionError);
      const result = { record: data };
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    }));

    server.registerTool('check_record_quality', {
      title: '提供記録の入力・予定差を確認',
      description: '権限のある記録の必須項目と日時を確認し、閲覧可能なシフトとの違いを要確認として返します。記録は変更しません。',
      inputSchema: z.object({ organization_id: uuid, record_id: uuid }),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }, async ({ organization_id, record_id }) => observeMcpTool('check_record_quality', async () => {
      const { data, error } = await supabase.rpc('get_mcp_record_quality_source', { p_organization_id: organization_id, p_record_id: record_id });
      if (error) throw new Error(connectionError);
      const result = { check: data ? checkRecordQuality(data, template) : null };
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    }));

    server.registerTool('propose_shift_change', {
      title: 'シフト変更案を確認',
      description: '確認済みシフトとスタッフのID、変更案の日時を指定して重複と担当登録を確認します。1人の案であり他の担当者や区間への影響は要確認です。変更は実行しません。',
      inputSchema: z.object({ organization_id: uuid, shift_id: uuid, staff_id: uuid, start_at: z.iso.datetime({ offset: true }), end_at: z.iso.datetime({ offset: true }) }),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }, async (args) => observeMcpTool('propose_shift_change', async () => {
      const { data, error } = await supabase.rpc('propose_mcp_shift_change', { p_organization_id: args.organization_id, p_shift_id: args.shift_id, p_staff_id: args.staff_id, p_start: args.start_at, p_end: args.end_at });
      if (error) throw new Error(connectionError);
      return { structuredContent: { proposal: data }, content: [{ type: 'text', text: JSON.stringify({ proposal: data }) }] };
    }));

    server.registerTool('list_staff_availability', {
      title: 'スタッフの割当候補を確認',
      description: '指定時間のシフト重複と利用者の担当登録を確認します。勤務予定、移動時間、資格などは要確認です。割当は変更しません。日時はタイムゾーン付きで指定します。',
      inputSchema: z.object({ organization_id: uuid, start_at: z.iso.datetime({ offset: true }), end_at: z.iso.datetime({ offset: true }), client_id: uuid.optional(), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(10000).default(0) }),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }, async (args) => observeMcpTool('list_staff_availability', async () => {
      const { data, error } = await supabase.rpc('list_mcp_staff_availability', { p_organization_id: args.organization_id, p_start: args.start_at, p_end: args.end_at, p_client_id: args.client_id ?? null, p_limit: args.limit, p_offset: args.offset });
      if (error) throw new Error(connectionError);
      return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
    }));

    server.registerTool('list_shifts', {
      title: 'シフトを検索',
      description: '事業所のシフトをJSTの期間で検索します。氏名ではなく確認済みのIDで絞り込んでください。DBが正本であり、Google同期状況は別です。',
      inputSchema: z.object({
        organization_id: uuid, start_date: z.iso.date(), end_date: z.iso.date(),
        client_id: uuid.optional(), staff_id: uuid.optional(), unassigned: z.boolean().default(false),
        sync_status: z.enum(['synced', 'pending_upsert', 'pending_delete', 'failed']).optional(),
        limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(10000).default(0),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }, async (args) => observeMcpTool('list_shifts', async () => {
      const { data: enabled, error: checkError } = await supabase.rpc('check_mcp_shift_read', { p_organization_id: args.organization_id });
      if (checkError || enabled !== true) throw new Error(connectionError);
      const { data, error } = await supabase.rpc('list_mcp_shifts', {
        p_organization_id: args.organization_id, p_start: args.start_date, p_end: args.end_date,
        p_client_id: args.client_id ?? null, p_staff_id: args.staff_id ?? null, p_unassigned: args.unassigned,
        p_sync_status: args.sync_status ?? null, p_limit: args.limit, p_offset: args.offset,
      });
      if (error) throw new Error(connectionError);
      return { structuredContent: data, content: [{ type: 'text', text: JSON.stringify(data) }] };
    }));

    server.registerTool('get_shift', {
      title: 'シフトの詳細を取得',
      description: '確認済みのシフトIDから権限内の詳細を取得します。見つからない場合は別の対象を推測しないでください。',
      inputSchema: z.object({ organization_id: uuid, shift_id: uuid }),
      annotations: { readOnlyHint: true, openWorldHint: false, destructiveHint: false },
    }, async ({ organization_id, shift_id }) => observeMcpTool('get_shift', async () => {
      const { data: enabled, error: checkError } = await supabase.rpc('check_mcp_shift_read', { p_organization_id: organization_id });
      if (checkError || enabled !== true) throw new Error(connectionError);
      const { data, error } = await supabase.rpc('get_mcp_shift', { p_organization_id: organization_id, p_shift_id: shift_id });
      if (error) throw new Error(connectionError);
      const result = { shift: data };
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    }));

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
    }, async ({ organization_id, source_file_name, record, send_anyway }) => observeMcpTool('submit_record_candidate', async () => {
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
        const { data: workspaces, error: workspaceError } = await supabase.rpc('list_mcp_workspaces');
        if (workspaceError || !(workspaces ?? []).some((item: { id: string }) => item.id === organization_id)) {
          throw new Error(connectionError);
        }
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
      if (error || !data) throw new Error(connectionError);
      const result = {
        candidate_id: data,
        status: 'submitted',
        review_url: appOrigin ? `${appOrigin}/app/ai-candidates` : null,
        message: 'AI読み取り記録を送信しました。管理者の確認待ちです。',
      };
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    }));

    return server;
  });
  return handler.fetch(request);
})));
