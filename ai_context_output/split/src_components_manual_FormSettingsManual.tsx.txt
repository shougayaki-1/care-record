'use client';

import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@/components/ui/mui';
import AddIcon from '@mui/icons-material/Add';
import AssignmentIndIcon from '@mui/icons-material/AssignmentInd';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DescriptionIcon from '@mui/icons-material/Description';
import EditNoteIcon from '@mui/icons-material/EditNote';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import { AppButton, DataTable, DynamicFormField, MultiSelectField, StatusChip, type DynamicFormItem, type DynamicFormValue } from '@/components/ui';
import { ManualCallout, ManualDefinitionList, ManualDemoFrame, ManualScreenHighlight, ManualSection, ManualStep } from '@/components/manual/ManualPrimitives';

type FormRow = DynamicFormItem & {
  purpose: string;
  example: string;
};

const formRows: FormRow[] = [
  { id: 'section-vital', label: '体調・バイタル', type: 'section', purpose: '記録の見出し', example: '体温、血圧、表情の確認をまとめる' },
  { id: 'temperature', label: '体温', type: 'number', required: true, purpose: '数値で比較したい項目', example: '36.5℃' },
  { id: 'meal', label: '食事・水分', type: 'multicheckbox', options: '朝食,昼食,夕食,水分補給,経管栄養,他', required: true, hasDetail: true, purpose: '複数該当するケア', example: '朝食、水分補給、他' },
  { id: 'medicine', label: '服薬確認', type: 'checkbox', required: true, hasDetail: true, purpose: '実施有無を短く残す', example: 'ON + 眠前薬は家族へ申し送り' },
  { id: 'excretion', label: '排泄状況', type: 'select', options: '問題なし,尿あり,便あり,失禁あり,未確認', required: true, hasDetail: true, purpose: '1つの状態を選ぶ', example: '便あり + 軟便少量' },
  { id: 'condition', label: '申し送り・特記事項', type: 'text', required: false, purpose: '自由記述', example: '発熱なし。表情良好。' },
  { id: 'night-check', label: '夜間見守り時刻', type: 'time', purpose: '時刻記録', example: '02:00' },
];

const staffOptions = [
  { id: 'sato', name: '佐藤 花子', role: 'サービス提供責任者', ghost: false },
  { id: 'tanaka', name: '田中 一郎', role: '常勤ヘルパー', ghost: false },
  { id: 'office-proxy', name: '事務代行アカウント', role: 'Ghost Staff', ghost: true },
];

export default function FormSettingsManual() {
  return (
    <Stack spacing={3}>
      <ManualSection title="フォーム設定が生む価値" subtitle="紙の自由記述をそのまま電子化するのではなく、迷わない入力と集計できる記録へ変える設計機能です。">
        <Stack spacing={1.5}>
          <ManualStep number={1} title="入力の迷いを減らす" body="よく使う回答はチェックボックスや選択式にして、スタッフが現場で短時間に入力できるようにします。" />
          <ManualStep number={2} title="記録品質を揃える" body="必須項目、詳細入力、セクション見出しを使うことで、スタッフごとの書き方のばらつきを減らします。" />
          <ManualStep number={3} title="紙やExcelより後工程が楽になる" body="構造化された回答はAI取込、帳票差し込み、統計確認に再利用でき、転記や読み解きの時間を削減します。" />
        </Stack>
      </ManualSection>

      <FormDesignerDemo />

      <ManualSection title="設計の考え方">
        <ManualDefinitionList
          items={[
            { term: 'チェック', description: '「服薬した」「換気した」のような実施有無に向きます。ONにした時だけ詳細欄を出すと、通常時は短く、例外時は詳しく残せます。' },
            { term: '複数選択', description: '食事・水分、身体介護、清掃項目など、複数該当するケアに向きます。「他」を入れて詳細入力を許可すると現場例外にも対応できます。' },
            { term: '1つ選択', description: '排泄状況、体調区分、サービス結果など、1つに決めたい状態に向きます。集計や帳票で読みやすくなります。' },
            { term: '自由記述', description: '申し送りや事故・ヒヤリハットなど、選択肢に閉じ込めると情報が落ちる項目に限定します。' },
          ]}
        />
      </ManualSection>

      <StaffAssignmentDemo />
    </Stack>
  );
}

function FormDesignerDemo() {
  const [answers, setAnswers] = useState<Record<string, DynamicFormValue>>({
    temperature: '36.5',
    meal: ['朝食', '水分補給'],
    medicine: true,
    excretion: '便あり',
    condition: '発熱なし。表情良好。右足のむくみは前回同様。',
    'night-check': '02:00',
  });
  const [details, setDetails] = useState<Record<string, string>>({
    meal: '水分300ml。朝食は全量摂取。',
    medicine: '眠前薬は未確認のため、ご家族へ申し送り。',
    excretion: '軟便少量。皮膚トラブルなし。',
  });
  const [showErrors, setShowErrors] = useState(false);

  const errors = useMemo(() => ({
    temperature: showErrors && !String(answers.temperature ?? '').trim() ? '必須項目です' : undefined,
    meal: showErrors && (!Array.isArray(answers.meal) || answers.meal.length === 0) ? '1つ以上選択してください' : undefined,
    medicine: showErrors && !answers.medicine ? '服薬確認は必須です' : undefined,
    excretion: showErrors && !answers.excretion ? '状態を選択してください' : undefined,
  }), [answers, showErrors]);

  const completion = Object.values(errors).some(Boolean) ? 62 : 100;

  return (
    <ManualDemoFrame title="記録フォーム設定：設計表と入力プレビュー">
      <Stack spacing={2.5}>
        <ManualScreenHighlight number={1} label="管理者は項目の目的を見ながら設計">
          <DataTable
            rows={formRows}
            getRowKey={(row) => row.id}
            columns={[
              { key: 'label', header: '項目名', render: (row) => <Typography fontWeight={800}>{row.label}</Typography> },
              { key: 'type', header: '種類', render: (row) => <Chip label={typeLabel(row.type)} size="small" color={row.type === 'section' ? 'primary' : 'default'} variant={row.type === 'section' ? 'filled' : 'outlined'} /> },
              { key: 'required', header: '必須', render: (row) => row.required ? <StatusChip label="必須" tone="warning" size="small" /> : <StatusChip label="任意" tone="default" size="small" /> },
              { key: 'detail', header: '詳細入力', render: (row) => row.hasDetail ? <StatusChip label="許可" tone="info" size="small" /> : '-' },
              { key: 'purpose', header: '設計意図', render: (row) => row.purpose },
              { key: 'example', header: '現場例', render: (row) => <Typography variant="body2" color="text.secondary">{row.example}</Typography> },
            ]}
          />
        </ManualScreenHighlight>

        <ManualScreenHighlight number={2} label="ヘルパー視点の入力プレビュー">
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Paper variant="outlined" sx={{ flex: 1, overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1.5, bgcolor: 'background.subtle', borderBottom: 1, borderColor: 'divider' }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <EditNoteIcon color="action" />
                  <Box>
                    <Typography fontWeight={800}>鈴木 一郎 様 記録プレビュー</Typography>
                    <Typography variant="caption" color="text.secondary">重度訪問介護 22:00-翌09:00</Typography>
                  </Box>
                </Stack>
              </Box>
              <Stack divider={<Divider />}>
                {formRows.map((item) => item.type === 'section' ? (
                  <Box key={item.id} sx={{ px: 2, py: 1.25, bgcolor: 'background.tint' }}>
                    <Typography fontWeight={900} color="primary.main">{item.label}</Typography>
                  </Box>
                ) : (
                  <Box key={item.id} sx={{ p: 2, bgcolor: errors[item.id as keyof typeof errors] ? 'background.danger' : 'transparent' }}>
                    <DynamicFormField
                      item={item}
                      value={answers[item.id]}
                      detailValue={details[item.id] ?? ''}
                      error={errors[item.id as keyof typeof errors]}
                      onChange={(value) => setAnswers((current) => ({ ...current, [item.id]: value }))}
                      onDetailChange={(value) => setDetails((current) => ({ ...current, [item.id]: value }))}
                    />
                  </Box>
                ))}
              </Stack>
            </Paper>

            <Paper variant="outlined" sx={{ width: { md: 300 }, p: 2, alignSelf: 'flex-start' }}>
              <Stack spacing={2}>
                <Typography fontWeight={800}>入力品質チェック</Typography>
                <Box>
                  <LinearProgress variant="determinate" value={completion} sx={{ height: 8, borderRadius: 1 }} />
                  <Typography variant="caption" color="text.secondary">完了率 {completion}%</Typography>
                </Box>
                <Alert severity={Object.values(errors).some(Boolean) ? 'warning' : 'success'}>
                  {Object.values(errors).some(Boolean) ? '赤枠の必須項目を修正すると保存できます。' : '必須項目は入力済みです。'}
                </Alert>
                <AppButton startIcon={<ErrorOutlineIcon />} intent="warning" onClick={() => {
                  setShowErrors(true);
                  setAnswers((current) => ({ ...current, meal: [], medicine: false }));
                }}>
                  エラー状態を再現
                </AppButton>
                <AppButton startIcon={<CheckCircleIcon />} variant="outlined" onClick={() => {
                  setShowErrors(false);
                  setAnswers((current) => ({ ...current, meal: ['朝食', '水分補給'], medicine: true, excretion: '便あり', temperature: '36.5' }));
                }}>
                  入力済みに戻す
                </AppButton>
              </Stack>
            </Paper>
          </Stack>
        </ManualScreenHighlight>
      </Stack>
      <ManualCallout tone="success" title="提案ポイント">
        紙の記録では「何を書けばよいか」が人に依存します。CareRecordでは項目設計で迷いを減らし、必須チェックと詳細入力で記録品質を保ちながら、帳票・統計へ再利用できます。
      </ManualCallout>
    </ManualDemoFrame>
  );
}

function StaffAssignmentDemo() {
  const [assigned, setAssigned] = useState([staffOptions[0], staffOptions[2]]);

  return (
    <ManualDemoFrame title="担当スタッフ設定とGhost Staff運用">
      <Stack spacing={2.5}>
        <ManualScreenHighlight number={3} label="利用者ごとに担当者を紐付け">
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
            <Box sx={{ flex: 1 }}>
              <MultiSelectField
                label="鈴木 一郎 様の担当スタッフ"
                options={staffOptions}
                value={assigned}
                onChange={setAssigned}
                getOptionLabel={(staff) => staff.name}
                getOptionValue={(staff) => staff.id}
                helperText="担当のみ権限の表示範囲、記録作成候補、シフト表示に反映されます。"
              />
            </Box>
            <Paper variant="outlined" sx={{ width: { md: 340 }, p: 2 }}>
              <Typography fontWeight={800} gutterBottom>選択中の担当</Typography>
              <Stack spacing={1}>
                {assigned.map((staff) => (
                  <Stack key={staff.id} direction="row" spacing={1} alignItems="center">
                    <AssignmentIndIcon color={staff.ghost ? 'warning' : 'action'} fontSize="small" />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography fontWeight={800}>{staff.name}</Typography>
                      <Typography variant="caption" color="text.secondary">{staff.role}</Typography>
                    </Box>
                    {staff.ghost && <Chip label="Ghost Staff" color="warning" variant="outlined" />}
                  </Stack>
                ))}
              </Stack>
            </Paper>
          </Stack>
        </ManualScreenHighlight>

        <ManualScreenHighlight number={4} label="事務員による代行入力の安全な運用">
          <Stack spacing={1.5}>
            <Alert severity="info" icon={<FactCheckIcon />}>
              スタッフ紐付けなしアカウントを使う事務員は、実績担当としてGhost Staffを選ぶのではなく、実際に訪問したスタッフを記録内で選択します。
            </Alert>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 1.5 }}>
              <ReasonCard icon={<DescriptionIcon color="primary" />} title="代行入力を明確化" body="記録作成者と実績担当を分けて残せるため、誰が入力し、誰が訪問したかを監査できます。" />
              <ReasonCard icon={<AssignmentIndIcon color="warning" />} title="担当のみ表示を維持" body="Ghost Staffを利用者担当に入れることで、事務員が必要な利用者だけを開ける運用にできます。" />
              <ReasonCard icon={<AddIcon color="success" />} title="退職・異動に強い" body="アカウントとスタッフ名簿を分けるため、退職者の記録担当履歴を残したままログイン権限だけ停止できます。" />
            </Box>
          </Stack>
        </ManualScreenHighlight>
      </Stack>
    </ManualDemoFrame>
  );
}

function ReasonCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center">
          {icon}
          <Typography fontWeight={800}>{title}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">{body}</Typography>
      </Stack>
    </Paper>
  );
}

function typeLabel(type: DynamicFormItem['type']) {
  const labels: Record<DynamicFormItem['type'], string> = {
    section: 'セクション',
    text: '自由記述',
    number: '数値',
    checkbox: 'チェック',
    time: '時刻',
    select: '1つ選択',
    multicheckbox: '複数選択',
  };
  return labels[type];
}
