'use server';

import { createHmac, randomUUID } from 'crypto';
import { assertOrgRole, getAuthedUser, supabaseAdmin } from '@/utils/supabase/auth';
import { recordAuditEvent } from '@/utils/supabase/audit';
import { convertSchemaToReadable, type FormItem } from '@/utils/templateHelper';

const GAS_API_URL = process.env.GAS_API_URL;
const GAS_SHARED_SECRET = process.env.GAS_SHARED_SECRET;

const ALLOWED_ACTIONS = new Set([
  'manage_org_folder',
  'manage_client_folder',
  'create_sub_folder',
  'create_pdf',
  'create_template_doc',
]);

type GasPayload = Record<string, unknown> & {
  action: string;
  organizationId: string;
};

function validatePayload(payload: GasPayload) {
  if (!payload.organizationId || typeof payload.organizationId !== 'string') {
    throw new Error('事業所IDが不正です');
  }
  if (!ALLOWED_ACTIONS.has(payload.action)) {
    throw new Error('許可されていないGAS操作です');
  }

  const serialized = JSON.stringify(payload);
  if (serialized.length > 2_000_000) {
    throw new Error('GASへの送信データが大きすぎます');
  }
  return serialized;
}

async function sanitizeGasPayload(payload: GasPayload, userEmail?: string) {
  const base = { ...payload, userEmail };
  switch (payload.action) {
    case 'manage_org_folder': {
      const { data, error } = await supabaseAdmin
        .from('organizations')
        .select('name, google_folder_id')
        .eq('id', payload.organizationId)
        .is('deleted_at', null)
        .single();
      if (error || !data) throw new Error('事業所が見つかりません');
      return { ...base, orgName: data.name, currentFolderId: data.google_folder_id };
    }
    case 'manage_client_folder': {
      const clientId = String(payload.clientId || '');
      const [{ data: client }, { data: organization }] = await Promise.all([
        supabaseAdmin.from('clients').select('name, google_folder_id').eq('id', clientId).eq('organization_id', payload.organizationId).single(),
        supabaseAdmin.from('organizations').select('google_folder_id').eq('id', payload.organizationId).single(),
      ]);
      if (!client || !organization?.google_folder_id) throw new Error('利用者または事業所フォルダが見つかりません');
      return {
        ...base,
        clientId,
        clientName: client.name,
        orgFolderId: organization.google_folder_id,
        currentFolderId: client.google_folder_id,
      };
    }
    case 'create_template_doc': {
      const clientId = String(payload.clientId || '');
      const [{ data: client }, { data: template }] = await Promise.all([
        supabaseAdmin.from('clients').select('name, google_folder_id').eq('id', clientId).eq('organization_id', payload.organizationId).single(),
        supabaseAdmin.from('form_templates').select('schema').eq('client_id', clientId).maybeSingle(),
      ]);
      if (!client?.google_folder_id) throw new Error('利用者フォルダが見つかりません');
      return {
        ...base,
        clientId,
        clientName: client.name,
        folderId: client.google_folder_id,
        schema: convertSchemaToReadable((template?.schema || []) as FormItem[]),
      };
    }
    case 'create_sub_folder': {
      const clientId = String(payload.clientId || '');
      const { data: client } = await supabaseAdmin
        .from('clients')
        .select('google_folder_id')
        .eq('id', clientId)
        .eq('organization_id', payload.organizationId)
        .single();
      if (!client?.google_folder_id || payload.parentId !== client.google_folder_id) {
        throw new Error('出力先フォルダが不正です');
      }
      return base;
    }
    case 'create_pdf': {
      const reportId = String(payload.reportId || '');
      const clientId = String(payload.clientId || '');
      const [{ data: report }, { data: client }] = await Promise.all([
        supabaseAdmin.from('reports').select('id, client_id').eq('id', reportId).eq('client_id', clientId).is('deleted_at', null).single(),
        supabaseAdmin.from('clients').select('google_template_id').eq('id', clientId).eq('organization_id', payload.organizationId).single(),
      ]);
      if (!report || !client?.google_template_id) throw new Error('出力対象の記録またはテンプレートが不正です');
      return { ...base, reportId, clientId, templateId: client.google_template_id };
    }
    default:
      throw new Error('許可されていないGAS操作です');
  }
}

/**
 * Google Drive/GAS操作の共通境界。
 * 呼出元の画面表示制御は信用せず、セッションと事業所ロールを毎回検証する。
 */
export async function callGasApi(payload: GasPayload) {
  if (!GAS_API_URL) throw new Error('GAS_API_URL is not defined');
  if (!GAS_SHARED_SECRET) throw new Error('GAS_SHARED_SECRET is not configured');

  const allowedRoles = payload.action === 'manage_org_folder'
    ? (['owner'] as const)
    : (['owner', 'member'] as const);
  await assertOrgRole(payload.organizationId, [...allowedRoles]);
  const user = await getAuthedUser();

  const organizationId = payload.organizationId;
  const gasPayload = await sanitizeGasPayload(payload, user.email);
  const timestamp = Date.now().toString();
  const nonce = randomUUID();
  const requestBody = JSON.stringify({
    ...gasPayload,
    orgId: organizationId,
    requestedBy: user.id,
    requestedByEmail: user.email,
    requestTimestamp: timestamp,
    requestNonce: nonce,
  });
  validatePayload(payload);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  headers['X-CareRecord-Timestamp'] = timestamp;
  headers['X-CareRecord-Nonce'] = nonce;
  headers['X-CareRecord-Signature'] = createHmac('sha256', GAS_SHARED_SECRET)
    .update(`${timestamp}.${nonce}.${requestBody}`)
    .digest('hex');

  try {
    const response = await fetch(GAS_API_URL, {
      method: 'POST',
      headers,
      body: requestBody,
      // GASのリダイレクトを追跡する
      redirect: 'follow',
      cache: 'no-store',
    });

    if (!response.ok) {
        throw new Error(`GAS API responded with status ${response.status}`);
    }

    const data = await response.json();
    await recordAuditEvent({
      organizationId,
      actorId: user.id,
      action: `google_drive.${payload.action}`,
      resourceType: 'google_drive',
      details: { gasAction: payload.action },
    });
    return data;
  } catch (error) {
    console.error('GAS Action Error:', error);
    await recordAuditEvent({
      organizationId,
      actorId: user.id,
      action: `google_drive.${payload.action}`,
      resourceType: 'google_drive',
      outcome: 'failure',
      details: { gasAction: payload.action, errorType: error instanceof Error ? error.name : 'unknown' },
    });
    return { status: 'error', message: 'Google Drive操作に失敗しました' };
  }
}
