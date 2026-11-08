'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { Alert, Box, CircularProgress, Stack, Typography } from '@/components/ui/mui';
import { AppButton, PageBody, PageLayout } from '@/components/ui';
import { getMcpRecordEditReview, confirmMcpRecordEdit } from '@/app/actions/mcpRecordEditReview';
import { DEFAULT_TEMPLATE } from '@/constants/formTemplates';
import { getActionErrorMessage, readActionResult } from '@/utils/actionResult';

async function readReview(id: string) { return readActionResult(getMcpRecordEditReview(id)); }
type Review = Awaited<ReturnType<typeof readReview>>;
type Details = Extract<Review, { status: 'confirmation_required' | 'correction_proposed' }>;
type Result = Awaited<ReturnType<typeof confirm>>;
async function confirm(id: string) { return readActionResult(confirmMcpRecordEdit(id)); }
const dateTime = (value: string) => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', dateStyle: 'full', timeStyle: 'short' }).format(new Date(value));
const showValue = (value: unknown) => value === undefined ? '（項目なし）' : value === null ? '（未入力）' : typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const extraLabels: Record<string, string> = { service_time: '提供時間', travel_time: '移動時間', round_trip_distance_km: '往復距離', travel_cost_yen: '交通費', travel_expenses: 'スタッフ別交通費', _helpers: '担当者' };

function changeKeys(review: Details) {
  const before = review.before.values;
  const after = review.proposal.values;
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
}

function fieldLabel(review: Details, key: string): string | null {
  const fields = review.references.form_schema ?? DEFAULT_TEMPLATE;
  const detail = key.endsWith('_detail');
  const item = fields.find(field => field.id === (detail ? key.slice(0, -7) : key));
  return item ? detail ? `${item.label}：${item.detailLabel || '補足'}` : item.label
    : Object.hasOwn(extraLabels, key) ? extraLabels[key] : null;
}

function Changes({ review }: { review: Details }) {
  const before = review.before.values;
  const after = review.proposal.values;
  const keys = changeKeys(review);
  const nameOf = (items: Array<{ id: string; name: string }>, id?: string | null) => id ? items.find(item => item.id === id)?.name ?? '確認できません' : '未設定';
  const staff = (items: Details['proposal']['actual_staffs']) => items.length ? items.map(item => `${nameOf(review.references.staffs, item.staff_id)}（役割: ${nameOf(review.references.staff_roles, item.staff_role_id)}）`).join('、') : '担当者なし';
  const metadataChanged = JSON.stringify([review.before.start_at, review.before.end_at, review.before.actual_service_type_id, review.before.actual_staffs]) !==
    JSON.stringify([review.proposal.start_at, review.proposal.end_at, review.proposal.actual_service_type_id, review.proposal.actual_staffs]);
  return <Box component="section" aria-label="変更内容">
    <Typography variant="h6">変更内容</Typography>
    {metadataChanged && <Box component="section" aria-label="日時・担当者の変更" sx={{ mt: 2 }}>
      <Typography fontWeight="bold">日時・サービス・担当者</Typography>
      <Typography>変更前: {dateTime(review.before.start_at)} ～ {dateTime(review.before.end_at)}（日本時間）</Typography>
      <Typography>サービス: {nameOf(review.references.service_types, review.before.actual_service_type_id)} ／ 担当: {staff(review.before.actual_staffs)}</Typography>
      <Typography>変更後: {dateTime(review.proposal.start_at)} ～ {dateTime(review.proposal.end_at)}（日本時間）</Typography>
      <Typography>サービス: {nameOf(review.references.service_types, review.proposal.actual_service_type_id)} ／ 担当: {staff(review.proposal.actual_staffs)}</Typography>
    </Box>}
    {keys.length === 0 && !metadataChanged ? <Alert severity="warning">変更内容を確認できません。</Alert> : keys.map(key => <Box key={key} component="section" sx={{ mt: 2 }}>
      <Typography fontWeight="bold">{fieldLabel(review, key) ?? `不明な項目: ${key}`}</Typography>
      <Typography>変更前</Typography>
      <Typography component="div" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{showValue(before[key])}</Typography>
      <Typography>変更後</Typography>
      <Typography component="div" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{showValue(after[key])}</Typography>
    </Box>)}
  </Box>;
}

function ReviewContent({ id }: { id: string }) {
  const [review, setReview] = useState<Review | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    let active = true;
    void readReview(id).then(value => { if (active) setReview(value); })
      .catch(err => { if (active) setError(getActionErrorMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  async function save() {
    setSaving(true);
    setError(null);
    try { setResult(await confirm(id)); }
    catch (err) { setError(getActionErrorMessage(err)); }
    finally { setSaving(false); }
  }
  const details = review?.status === 'confirmation_required' || review?.status === 'correction_proposed' ? review : null;
  const changesKnown = details && (() => {
    const known = (items: Array<{ id: string; name: string }>, value?: string | null) => !value || items.some(item => item.id === value && item.name);
    const metadataChanged = JSON.stringify([details.before.start_at, details.before.end_at, details.before.actual_service_type_id, details.before.actual_staffs]) !==
      JSON.stringify([details.proposal.start_at, details.proposal.end_at, details.proposal.actual_service_type_id, details.proposal.actual_staffs]);
    return (changeKeys(details).length > 0 || metadataChanged) && changeKeys(details).every(key => fieldLabel(details, key))
      && [details.before, details.proposal].every(content => known(details.references.service_types, content.actual_service_type_id)
        && content.actual_staffs.every(person => known(details.references.staffs, person.staff_id) && known(details.references.staff_roles, person.staff_role_id)));
  })();
  return <PageLayout><PageBody><Stack spacing={2}>
    <Typography variant="h5" fontWeight="bold">AI からの記録変更案を確認</Typography>
    {error && <Alert severity="error">{error}</Alert>}
    {loading ? <CircularProgress aria-label="読み込み中" /> : details ? <>
      <Typography>事業所: {details.references.organization.name}</Typography>
      <Typography>利用者: {details.references.client.name}</Typography>
      <Typography>記録日: {details.references.report.service_date ?? '未設定'} ／ 記録 ID: {details.references.report.id}</Typography>
      <Typography>開始: {details.references.report.start_at ? dateTime(details.references.report.start_at) : '未設定'} ／ 終了: {details.references.report.end_at ? dateTime(details.references.report.end_at) : '未設定'}（日本時間）</Typography>
      <Typography>対象の状態: {details.before.status === 'approved' ? '承認済み' : '下書き'}</Typography>
      <Typography>理由: {details.reason}</Typography>
      <Changes review={details} />
      {details.status === 'confirmation_required' && <Typography>確認期限: {dateTime(details.expires_at)}（日本時間）</Typography>}
      {details.before.status === 'approved' && <Alert severity="info">保存するのは訂正案です。承認済みの記録と版は変更されず、記録の訂正や再承認は行われません。</Alert>}
      {details.status === 'correction_proposed' && <>
        <Alert severity="success">訂正案を保存しました。承認済みの記録は変更されていません。</Alert>
        {details.base_changed && <Alert severity="warning">元の記録が変更されています。この案を利用するときは元の記録と照合してください。</Alert>}
      </>}
      {result ? <Alert severity="success">{result.status === 'updated' ? '下書きを保存しました。' : '訂正案を保存しました。承認済みの記録は変更されていません。'}</Alert>
        : details.status === 'confirmation_required' && (changesKnown ? <AppButton onClick={() => void save()} loading={saving}>
          {details.before.status === 'approved' ? 'この内容を訂正案として保存' : 'この内容で下書きを保存'}
        </AppButton> : <Alert severity="warning">変更項目を確認できないため、この案は保存できません。</Alert>)}
    </> : review?.status === 'expired' ? <Alert severity="warning">確認期限が切れました。新しい案を作成してください。</Alert>
      : review?.status === 'changed' ? <Alert severity="warning">対象が変更されました。新しい案を作成してください。</Alert>
      : review?.status === 'updated' ? <Alert severity="success">下書きは保存済みです。</Alert> : null}
    <AppButton component={Link} href="/app/mcp-record-corrections" variant="outlined">保存した訂正案を確認</AppButton>
    <AppButton component={Link} href="/app" variant="outlined">戻る</AppButton>
  </Stack></PageBody></PageLayout>;
}

export default function McpRecordEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <ReviewContent key={id} id={id} />;
}
