'use client';

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@/components/ui/mui';
import BuildIcon from '@mui/icons-material/Build';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DescriptionIcon from '@mui/icons-material/Description';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import SettingsIcon from '@mui/icons-material/Settings';
import SyncIcon from '@mui/icons-material/Sync';
import { AppButton, AppTextField, PageBody, PageLayout } from '@/components/ui';
import { ManualCallout, ManualDefinitionList, ManualDemoFrame, ManualScreenHighlight, ManualSection, ManualStep } from '@/components/manual/ManualPrimitives';

const mergeTags = [
  { tag: '{{利用者名}}', description: '帳票対象の利用者名' },
  { tag: '{{サービス日}}', description: '記録の日付' },
  { tag: '{{開始時間}}', description: 'サービス開始時刻' },
  { tag: '{{終了時間}}', description: 'サービス終了時刻' },
  { tag: '{{担当スタッフ}}', description: '実績担当スタッフ名' },
  { tag: '{{記録_食事・水分}}', description: '記録フォーム項目の回答' },
];

export default function IntegrationGuideManual() {
  return (
    <Stack spacing={3}>
      <ManualSection title="導入時に行うGoogle連携と帳票セットアップ" subtitle="管理者が最初に整える、保存先・カレンダー・テンプレートの設定手順です。">
        <Stack spacing={1.5}>
          <ManualStep number={1} title="事業所設定でGoogle連携" body="Googleドライブは帳票保存先、Googleカレンダーはシフト同期先です。権限を持つ管理者がOAuth連携します。" />
          <ManualStep number={2} title="利用者ごとの帳票テンプレート作成" body="利用者設定からテンプレートを作成し、差し込みタグを文書内へ配置します。" />
          <ManualStep number={3} title="同期エラーを修復" body="未同期件数や進捗を確認し、必要に応じて「未同期を同期」または「同期を修復」を実行します。" />
        </Stack>
      </ManualSection>

      <IntegrationSettingsDemo />

      <ManualSection title="差し込みタグの使い方">
        <ManualDefinitionList
          items={[
            { term: '固定タグ', description: '利用者名、サービス日、開始時間、終了時間など、どの帳票でも使う基本情報です。' },
            { term: '記録項目タグ', description: '記録フォーム設定で作った質問項目に対応します。項目名変更時はテンプレート側の見直しも行います。' },
            { term: 'コピー操作', description: 'タグ一覧からコピーし、Googleドキュメントや帳票テンプレート内の差し込みたい位置へ貼り付けます。' },
          ]}
        />
      </ManualSection>

      <TemplateSetupDemo />
    </Stack>
  );
}

function IntegrationSettingsDemo() {
  return (
    <ManualDemoFrame title="事業所設定：Googleドライブ / カレンダー連携">
      <PageLayout sx={{ height: 'auto', minHeight: 0, bgcolor: 'background.paper', border: 1, borderColor: 'divider' }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider', px: { xs: 2, sm: 3 }, bgcolor: 'background.paper' }}>
          <Stack direction="row" alignItems="center" height={64} spacing={2}>
            <SettingsIcon sx={{ color: 'action.active' }} />
            <Typography variant="h6" fontWeight={800}>事業所設定</Typography>
          </Stack>
        </Box>
        <PageBody maxWidth={820} sx={{ overflowY: 'visible' }}>
          <Stack spacing={3}>
            <ManualScreenHighlight number={1} label="Googleドライブ連携">
              <IntegrationCard
                icon={<CloudQueueIcon color="primary" fontSize="large" />}
                title="Googleドライブ連携"
                description="帳票の保存先フォルダを管理します"
                status="連携済み"
                tone="primary"
              >
                <Typography variant="body2">
                  連携中のフォルダID: <Box component="code" sx={{ overflowWrap: 'anywhere' }}>care-record-demo-folder</Box>
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
                  <AppButton variant="outlined" intent="secondary" startIcon={<LinkIcon />} onClick={() => undefined}>フォルダを開く</AppButton>
                  <AppButton variant="text" intent="danger" startIcon={<LinkOffIcon />} onClick={() => undefined}>連携を解除</AppButton>
                  <AppButton variant="text" intent="warning" onClick={() => undefined}>フォルダを再作成/修復</AppButton>
                </Stack>
              </IntegrationCard>
            </ManualScreenHighlight>

            <ManualScreenHighlight number={2} label="Googleカレンダー連携と同期修復">
              <IntegrationCard
                icon={<CalendarMonthIcon color="success" fontSize="large" />}
                title="Googleカレンダー連携"
                description="事業所専用カレンダーを自動作成し、シフトを同期します"
                status="連携済み"
                tone="success"
              >
                <Typography variant="body2">
                  連携中のカレンダーID: <Box component="code" sx={{ overflowWrap: 'anywhere' }}>care-record-demo-calendar@group.calendar.google.com</Box>
                </Typography>
                <Alert severity="warning">未同期の予定が <strong>3件</strong> あります（全42件中）。「未同期を同期」で解消できます。</Alert>
                <Box>
                  <LinearProgress variant="determinate" value={60} sx={{ height: 6, borderRadius: 1 }} />
                  <Typography variant="caption" color="text.secondary">3 / 5 件 処理中...</Typography>
                </Box>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} useFlexGap flexWrap="wrap">
                  <AppButton intent="warning" startIcon={<BuildIcon />} onClick={() => undefined}>未同期を同期（3件）</AppButton>
                  <AppButton variant="outlined" startIcon={<SyncIcon />} onClick={() => undefined}>同期を修復</AppButton>
                  <AppButton variant="outlined" intent="danger" startIcon={<LinkOffIcon />} onClick={() => undefined}>連携を解除</AppButton>
                </Stack>
              </IntegrationCard>
            </ManualScreenHighlight>
          </Stack>
        </PageBody>
      </PageLayout>
    </ManualDemoFrame>
  );
}

function IntegrationCard({
  icon,
  title,
  description,
  status,
  tone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: string;
  tone: 'primary' | 'success';
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, borderRadius: 1, bgcolor: tone === 'success' ? 'background.success' : 'background.tint' }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} alignItems={{ xs: 'flex-start', sm: 'center' }} gap={2} mb={2}>
        {icon}
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" fontWeight={800}>{title}</Typography>
          <Typography variant="body2" color="text.secondary">{description}</Typography>
        </Box>
        <Chip label={status} color={tone === 'success' ? 'success' : 'primary'} size="small" icon={<LinkIcon />} sx={{ ml: { sm: 'auto' } }} />
      </Stack>
      <Stack spacing={2} sx={{ mt: 2, p: 2, bgcolor: 'background.paper', borderRadius: 1, border: 1, borderColor: 'divider' }}>
        {children}
      </Stack>
    </Box>
  );
}

function TemplateSetupDemo() {
  return (
    <ManualDemoFrame title="利用者設定：帳票テンプレートと差し込みタグ">
      <Stack spacing={2.5}>
        <ManualScreenHighlight number={1} label="テンプレート作成">
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.5, bgcolor: 'background.subtle', borderBottom: 1, borderColor: 'divider' }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <DescriptionIcon color="action" />
                <Typography fontWeight={800}>山田 太郎 様 帳票テンプレート</Typography>
              </Stack>
            </Box>
            <Box sx={{ p: 2 }}>
              <Stack spacing={2}>
                <AppTextField label="テンプレート名" value="重度訪問介護 提供記録票" size="small" />
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                  <AppButton startIcon={<DescriptionIcon />} onClick={() => undefined}>テンプレートを作成</AppButton>
                  <AppButton variant="outlined" startIcon={<LinkIcon />} onClick={() => undefined}>Googleドキュメントを開く</AppButton>
                </Stack>
              </Stack>
            </Box>
          </Paper>
        </ManualScreenHighlight>

        <ManualScreenHighlight number={2} label="差し込みタグをコピー">
          <Accordion defaultExpanded disableGutters>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography fontWeight={800}>基本情報タグ</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack divider={<Divider flexItem />}>
                {mergeTags.map((item) => (
                  <Stack key={item.tag} direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ py: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography component="code" fontWeight={800}>{item.tag}</Typography>
                      <Typography variant="caption" color="text.secondary" display="block">{item.description}</Typography>
                    </Box>
                    <AppButton size="small" variant="outlined" startIcon={<ContentCopyIcon />} onClick={() => undefined}>コピー</AppButton>
                  </Stack>
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        </ManualScreenHighlight>

        <ManualScreenHighlight number={3} label="同期エラー時の案内">
          <Alert severity="info">
            テンプレートの保存先フォルダやカレンダー同期に失敗した場合は、事業所設定の連携状態、Google側の権限、未同期件数、修復ボタンの順に確認します。
          </Alert>
        </ManualScreenHighlight>
      </Stack>
      <ManualCallout tone="success" title="初期導入の完了条件">
        ドライブ連携済み、カレンダー連携済み、利用者ごとのテンプレート作成済み、差し込みタグ配置済み、未同期0件になれば、帳票・シフト同期の初期設定は完了です。
      </ManualCallout>
    </ManualDemoFrame>
  );
}
