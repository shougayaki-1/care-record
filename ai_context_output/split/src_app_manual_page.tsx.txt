'use client';

import { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Typography,
} from '@/components/ui/mui';
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import ArticleIcon from '@mui/icons-material/Article';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import BackupIcon from '@mui/icons-material/Backup';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ChecklistIcon from '@mui/icons-material/Checklist';
import DescriptionIcon from '@mui/icons-material/Description';
import EditNoteIcon from '@mui/icons-material/EditNote';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import KeyIcon from '@mui/icons-material/Key';
import ListAltIcon from '@mui/icons-material/ListAlt';
import LoginIcon from '@mui/icons-material/Login';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import PeopleIcon from '@mui/icons-material/People';
import PersonIcon from '@mui/icons-material/Person';
import SecurityIcon from '@mui/icons-material/Security';
import SettingsIcon from '@mui/icons-material/Settings';
import WorkHistoryIcon from '@mui/icons-material/WorkHistory';
import { ManualDemo } from '@/components/manual/ManualDemos';
import { ManualCallout, ManualDefinitionList, ManualSection, ManualStep } from '@/components/manual/ManualPrimitives';
import FormSettingsManual from '@/components/manual/FormSettingsManual';
import IntegrationGuideManual from '@/components/manual/IntegrationGuideManual';
import RecordAndAiManual from '@/components/manual/RecordAndAiManual';
import RolesAndPermissionsManual from '@/components/manual/RolesAndPermissionsManual';
import ShiftGuideManual from '@/components/manual/ShiftGuideManual';
import StatisticsManual from '@/components/manual/StatisticsManual';

type ManualId =
  | 'proposal'
  | 'start'
  | 'common'
  | 'permissions'
  | 'clients'
  | 'form-settings'
  | 'record'
  | 'ai-import'
  | 'internal-work'
  | 'shifts'
  | 'reports'
  | 'statistics'
  | 'staff'
  | 'accounts'
  | 'settings'
  | 'logs-backup'
  | 'security'
  | 'troubleshooting'
  | 'glossary';

type ManualItem = {
  id: ManualId;
  title: string;
  subtitle: string;
  audience: string;
  icon: React.ReactNode;
};

const manualItems: ManualItem[] = [
  { id: 'proposal', title: '提案書サマリー', subtitle: '導入価値・対象者・業務全体像', audience: '全員', icon: <MenuBookIcon /> },
  { id: 'start', title: '利用開始・ログイン', subtitle: '招待承諾、参加、事業所切替', audience: '全員', icon: <LoginIcon /> },
  { id: 'common', title: '共通画面と基本操作', subtitle: '上部バー、通知、サイドバー、一覧', audience: '全員', icon: <ChecklistIcon /> },
  { id: 'permissions', title: '権限と見え方の設計', subtitle: '全体・担当のみ・なしの実務差', audience: '管理者', icon: <AdminPanelSettingsIcon /> },
  { id: 'clients', title: '利用者管理と担当割当', subtitle: '登録、担当、詳細設定、表示範囲', audience: '管理者', icon: <PeopleIcon /> },
  { id: 'form-settings', title: '初期セットアップと記録フォーム設計', subtitle: '迷わない入力項目、必須、詳細入力', audience: '管理者', icon: <DescriptionIcon /> },
  { id: 'record', title: '日々の記録作成', subtitle: 'シフトから入力、日跨ぎ、必須チェック', audience: 'スタッフ', icon: <EditNoteIcon /> },
  { id: 'ai-import', title: 'AI一括取込とペーパーレス化', subtitle: '紙/PDFから候補作成、レビュー、警告確認', audience: '管理者', icon: <AutoFixHighIcon /> },
  { id: 'internal-work', title: '内勤記録と労務集計', subtitle: '訪問外業務の時間記録', audience: 'スタッフ', icon: <WorkHistoryIcon /> },
  { id: 'shifts', title: 'シフト作成とカレンダー展開', subtitle: 'ひな形、月次展開、上書き保護、同期', audience: '管理者・スタッフ', icon: <CalendarMonthIcon /> },
  { id: 'reports', title: '提供記録一覧と帳票出力', subtitle: '承認、差戻し、PDF一括生成', audience: '管理者', icon: <ArticleIcon /> },
  { id: 'statistics', title: '月末の予実確認', subtitle: '差異、担当不一致、実績漏れを潰す', audience: '管理者', icon: <AnalyticsIcon /> },
  { id: 'staff', title: 'スタッフ管理', subtitle: '名簿、職種、担当', audience: '管理者', icon: <PersonIcon /> },
  { id: 'accounts', title: 'アカウント・権限管理', subtitle: '招待、ロール割当', audience: 'オーナー', icon: <KeyIcon /> },
  { id: 'settings', title: 'Google連携と帳票セットアップ', subtitle: 'Drive、Calendar、テンプレート、同期修復', audience: 'オーナー', icon: <SettingsIcon /> },
  { id: 'logs-backup', title: '監査ログ・バックアップ', subtitle: '操作証跡、CSV、保全確認', audience: '管理者', icon: <BackupIcon /> },
  { id: 'security', title: 'セキュリティと監査対応', subtitle: '3省2ガイドライン、ログ、保持、削除', audience: '管理者', icon: <SecurityIcon /> },
  { id: 'troubleshooting', title: '同期エラーと困ったとき', subtitle: 'Google同期、保存不可、帳票不一致', audience: '全員', icon: <HelpOutlineIcon /> },
  { id: 'glossary', title: '用語集', subtitle: 'CareRecord の主要用語', audience: '全員', icon: <ListAltIcon /> },
];

export default function ManualPortalPage() {
  const [activeManual, setActiveManual] = useState<ManualId>('proposal');
  const activeItem = useMemo(() => manualItems.find((item) => item.id === activeManual) ?? manualItems[0], [activeManual]);

  return (
    <Box sx={{ display: 'flex', minHeight: '100%', bgcolor: 'background.default' }}>
      <Box
        component="nav"
        sx={{
          width: { xs: 280, lg: 340 },
          flexShrink: 0,
          borderRight: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper',
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          maxHeight: 'calc(100vh - 64px)',
          position: 'sticky',
          top: 0,
        }}
      >
        <Box sx={{ p: 2.5, borderBottom: 1, borderColor: 'divider', bgcolor: 'background.tint' }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <MenuBookIcon color="primary" />
            <Box>
              <Typography variant="h6" color="primary.main" fontWeight={800}>操作マニュアル提案書</Typography>
              <Typography variant="caption" color="text.secondary">CareRecord 活用・操作ガイド</Typography>
            </Box>
          </Stack>
        </Box>
        <List sx={{ overflowY: 'auto', py: 1 }}>
          {manualItems.map((item) => {
            const selected = item.id === activeManual;
            return (
              <ListItemButton
                key={item.id}
                selected={selected}
                onClick={() => setActiveManual(item.id)}
                sx={{ mx: 1, my: 0.25, borderRadius: 1, alignItems: 'flex-start' }}
              >
                <ListItemIcon sx={{ minWidth: 36, color: selected ? 'primary.main' : 'text.secondary', pt: 0.25 }}>
                  {item.icon}
                </ListItemIcon>
                <ListItemText
                  primary={item.title}
                  secondary={item.subtitle}
                  primaryTypographyProps={{ fontWeight: 800, fontSize: '0.92rem' }}
                  secondaryTypographyProps={{ fontSize: '0.75rem' }}
                />
              </ListItemButton>
            );
          })}
        </List>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 4 }, maxWidth: 1280, mx: 'auto' }}>
        <Stack spacing={2.5}>
          <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 }, borderRadius: 1, bgcolor: 'background.paper' }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
              <Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <Box sx={{ color: 'primary.main', display: 'flex' }}>{activeItem.icon}</Box>
                  <Chip label={activeItem.audience} size="small" color="primary" variant="outlined" />
                </Stack>
                <Typography component="h1" variant="h4" fontWeight={900}>
                  {activeItem.title}
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 1 }}>
                  {activeItem.subtitle}
                </Typography>
              </Box>
            </Stack>
          </Paper>

          <Box sx={{ display: { xs: 'block', md: 'none' } }}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 1 }}>
              <Typography variant="caption" fontWeight={800} color="text.secondary" sx={{ px: 1 }}>カテゴリ</Typography>
              <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', py: 1 }}>
                {manualItems.map((item) => (
                  <Chip
                    key={item.id}
                    label={item.title}
                    color={item.id === activeManual ? 'primary' : 'default'}
                    variant={item.id === activeManual ? 'filled' : 'outlined'}
                    onClick={() => setActiveManual(item.id)}
                  />
                ))}
              </Stack>
            </Paper>
          </Box>

          <Paper variant="outlined" sx={{ p: { xs: 2.5, md: 4 }, borderRadius: 1, bgcolor: 'background.paper' }}>
            <ManualContent id={activeManual} />
          </Paper>
        </Stack>
      </Box>
    </Box>
  );
}

function ManualContent({ id }: { id: ManualId }) {
  if (id === 'form-settings') return <FormSettingsContent />;
  if (id === 'shifts') return <ShiftContent />;
  if (id === 'proposal') return <ProposalContent />;
  if (id === 'clients') return <FeatureContent demo="clients" title="利用者管理" audience="管理者" related="記録フォーム設定、シフト管理、提供記録一覧" points={['利用者の新規登録、氏名編集、アーカイブ、削除状態への変更を扱います。', '担当スタッフが未設定の利用者は、記録作成や担当のみ権限の表示範囲に影響します。', '詳細設定から利用者ごとの記録フォーム、担当、基本情報を整備します。']} />;
  if (id === 'record' || id === 'ai-import') return <RecordAndAiContent />;
  if (id === 'internal-work') return <FeatureContent demo="internalWork" title="内勤記録" audience="スタッフ・管理者" related="統計・予実管理、スタッフ管理" points={['訪問以外の電話対応、記録整理、事務作業などを時間として残します。', '自分の内勤記録を作成し、権限がある管理者は全体の状況を確認します。', '統計や労務集計に反映されるため、業務内容と時間を具体的に入力します。']} />;
  if (id === 'reports') return <FeatureContent demo="reports" title="提供記録一覧・帳票" audience="管理者" related="記録作成、シフト管理、統計" points={['全件、未承認・差戻し、今月の記録などの切り口で確認します。', '内容確認後に承認、差戻し、PDF出力を行います。', 'シフト紐付けがある記録は予実確認や月次帳票で利用します。']} />;
  if (id === 'permissions' || id === 'accounts') return <RolesAndPermissionsContent />;
  if (id === 'logs-backup') return <FeatureContent demo="logs" title="ログ・バックアップ" audience="オーナー・管理者" related="セキュリティ、アカウント管理" points={['操作ログを日時、操作者、対象、結果で確認します。', 'CSVエクスポートは監査や問い合わせ対応の証跡として利用します。', 'バックアップ閲覧は保全状況の確認を目的とし、復元は運用手順に従って実施します。']} />;
  if (id === 'start') return <StartContent />;
  if (id === 'common') return <CommonContent />;
  if (id === 'statistics') return <StatisticsContent />;
  if (id === 'staff') return <TextOnlyContent title="スタッフ管理" audience="管理者" related="アカウント管理、利用者管理、シフト管理" points={['スタッフ名簿は、シフト担当、利用者担当、記録担当の候補として利用します。', 'ログインするアカウントとは別概念のため、名簿登録だけではログインできません。', '職種、稼働状況、担当利用者を整備することで、担当のみ権限の表示範囲が明確になります。']} />;
  if (id === 'settings') return <IntegrationGuideContent />;
  if (id === 'security') return <SecurityContent />;
  if (id === 'troubleshooting') return <TroubleshootingContent />;
  return <GlossaryContent />;
}

function ProposalContent() {
  return (
    <Stack spacing={3}>
      <ManualSection title="マニュアル整備の目的" subtitle="CareRecord の導入・運用・教育・監査対応をひとつの文書体系で支える提案です。">
        <Stack spacing={1.5}>
          <Typography>本マニュアルは、現場スタッフが迷わず記録でき、管理者が設定・承認・監査対応を一貫して説明できる状態を目指します。</Typography>
          <ManualCallout title="提案の中核">文字だけの説明ではなく、実際の CareRecord UI コンポーネントで作った操作画面デモを各章に配置します。UI変更時もコンポーネントを追従させやすく、古いスクリーンショットが残るリスクを抑えます。</ManualCallout>
        </Stack>
      </ManualSection>
      <ManualSection title="想定読者と読み方">
        <ManualDefinitionList
          items={[
            { term: '一般スタッフ', description: 'ログイン、自分のシフト、記録作成、内勤記録、自分の履歴、困ったときの確認を中心に読みます。' },
            { term: '管理者', description: '利用者、スタッフ、シフト、記録フォーム、帳票、統計、AI取込、承認フローを中心に読みます。' },
            { term: 'オーナー', description: 'アカウント、ロール、事業所設定、ログ、バックアップ、セキュリティ運用を中心に読みます。' },
          ]}
        />
      </ManualSection>
      <ManualSection title="掲載範囲">
        <Stack spacing={1.5}>
          <ManualStep number={1} title="業務フロー別" body="記録する、シフトを作る、承認する、月次確認する、招待する、といった実務の順序で説明します。" />
          <ManualStep number={2} title="機能リファレンス" body="画面ごとに目的、対象者、操作、注意点、関連機能を整理し、必要な箇所だけ参照できます。" />
          <ManualStep number={3} title="運用・監査" body="権限、ログ、バックアップ、削除、セキュリティなど、運用責任者が説明すべき項目も含めます。" />
        </Stack>
      </ManualSection>
    </Stack>
  );
}

function FeatureContent({ title, audience, related, points, demo }: { title: string; audience: string; related: string; points: string[]; demo: React.ComponentProps<typeof ManualDemo>['kind'] }) {
  return (
    <Stack spacing={3}>
      <TextOnlyContent title={title} audience={audience} related={related} points={points} compact />
      <ManualDemo kind={demo} />
    </Stack>
  );
}

function TextOnlyContent({ title, audience, related, points, compact = false }: { title: string; audience: string; related: string; points: string[]; compact?: boolean }) {
  return (
    <Stack spacing={3}>
      <ManualSection title={compact ? `${title}の掲載内容` : title} subtitle={`対象者: ${audience}`}>
        <Stack spacing={1.5}>
          {points.map((point, index) => <ManualStep key={point} number={index + 1} title={index === 0 ? '目的' : index === 1 ? '基本操作' : '注意点'} body={point} />)}
        </Stack>
      </ManualSection>
      <ManualCallout title="関連機能">{related}</ManualCallout>
    </Stack>
  );
}

function FormSettingsContent() {
  return (
    <Stack spacing={3}>
      <TextOnlyContent title="記録フォーム設定" audience="管理者" related="利用者管理、記録作成、AI一括取込" compact points={['利用者ごとに記録項目を設計し、現場スタッフが迷わず入力できる状態を作ります。', '標準テンプレート、他利用者からのコピー、項目追加、順序変更、必須設定を扱います。', '設定変更後の入力画面への見え方と、既存記録への影響を説明します。']} />
      <Divider />
      <FormSettingsManual />
    </Stack>
  );
}

function ShiftContent() {
  return (
    <Stack spacing={3}>
      <TextOnlyContent title="シフト管理" audience="管理者・スタッフ" related="記録作成、Googleカレンダー、帳票、統計" compact points={['基本パターン、単発シフト、日またぎ、キャンセル、月次展開をまとめて説明します。', '管理者は全体カレンダー、スタッフ別、利用者別で予定を確認します。スタッフは自分のシフトから記録へ進みます。', 'PDF出力とGoogle同期は、運用前に確認すべき重要機能として扱います。']} />
      <Divider />
      <ShiftGuideManual />
    </Stack>
  );
}

function RecordAndAiContent() {
  return (
    <Stack spacing={3}>
      <TextOnlyContent title="記録作成・AI一括取込" audience="スタッフ・管理者" related="自分のシフト、提供記録一覧、記録フォーム設定、統計" compact points={['現場スタッフが日々使う記録作成と、紙・PDFから候補を作るAI取込を一連の流れとして説明します。', '日またぎ夜勤、サービス区間、必須エラー、詳細入力、AIハイライト、レビュー保存までを実UIに近いデモで確認できます。', 'マニュアル内の操作は静的なモックで、保存・削除・AI API呼び出しは実行されません。']} />
      <Divider />
      <RecordAndAiManual />
    </Stack>
  );
}

function StatisticsContent() {
  return (
    <Stack spacing={3}>
      <TextOnlyContent title="統計・予実管理" audience="管理者" related="シフト管理、提供記録一覧、内勤記録" compact points={['スタッフ別・利用者別に提供時間、勤務時間、内勤時間を確認します。', 'シフト予定と実績記録の差分を確認し、未入力・時間不整合・担当不一致・承認漏れを発見します。', '集計値が想定と異なる場合は、対象期間、承認状態、シフト紐付け、削除状態を確認します。']} />
      <Divider />
      <StatisticsManual />
    </Stack>
  );
}

function IntegrationGuideContent() {
  return (
    <Stack spacing={3}>
      <TextOnlyContent title="Google連携・帳票セットアップ" audience="オーナー・管理者" related="事業所設定、利用者設定、シフト管理、提供記録一覧" compact points={['事業所のGoogleドライブとGoogleカレンダー連携を初期設定し、帳票保存とシフト同期を使える状態にします。', '利用者設定で帳票テンプレートを作成し、開始時間などの差し込みタグをコピーして帳票へ配置します。', '同期エラー発生時は未同期件数、進捗、修復ボタンの意味を確認して復旧します。']} />
      <Divider />
      <IntegrationGuideManual />
    </Stack>
  );
}

function RolesAndPermissionsContent() {
  return (
    <Stack spacing={3}>
      <TextOnlyContent title="権限とロール" audience="オーナー・管理者" related="スタッフ管理、事業所設定、ログ" compact points={['権限は「全体」「担当のみ」「なし」と、管理機能ごとの許可で構成されます。', '複数ロールを割り当てた場合、より強い権限が有効になります。', 'シフトカレンダーや記録一覧の見え方は、担当割当とロール設定によって変わります。']} />
      <Divider />
      <RolesAndPermissionsManual />
    </Stack>
  );
}

function StartContent() {
  return (
    <Stack spacing={3}>
      <ManualSection title="利用開始の流れ" subtitle="招待を受ける人と、事業所を作る人の両方を説明します。">
        <Stack spacing={1.5}>
          <ManualStep number={1} title="ログイン" body="メール/パスワードまたは Google ログインで CareRecord に入ります。" />
          <ManualStep number={2} title="招待を承諾" body="招待リンクまたは招待コードから事業所へ参加します。招待先の事業所名、対象者名、付与ロールを確認します。" />
          <ManualStep number={3} title="事業所を切り替え" body="複数事業所に所属している場合は、上部バーの事業所名から作業対象を選びます。" />
        </Stack>
      </ManualSection>
      <ManualCallout tone="warning" title="ログインできない場合">招待の期限、メールアドレス、利用規約同意、パスワードポリシー、アカウント停止状態を順に確認します。</ManualCallout>
    </Stack>
  );
}

function CommonContent() {
  return (
    <Stack spacing={3}>
      <ManualSection title="共通画面の見方">
        <ManualDefinitionList
          items={[
            { term: '上部バー', description: '事業所切替、通知、アカウント設定、ログアウトを集約します。' },
            { term: '左サイドバー', description: '記録、AI一括取込、内勤、自分の履歴、シフト、管理系画面へ移動します。権限がないメニューは表示されません。' },
            { term: '通知', description: '承認、差戻し、システムからの連絡などを確認できます。未読はバッジで示されます。' },
            { term: '一覧操作', description: '検索、状態確認、編集、詳細設定、アーカイブ、削除などは各一覧の操作列に集約されます。' },
          ]}
        />
      </ManualSection>
      <ManualCallout title="スマホ表示">スマホではサイドバーが折りたたまれ、一覧はカード型表示になります。操作名はアイコンのツールチップや周辺文言と合わせて説明します。</ManualCallout>
    </Stack>
  );
}

function SecurityContent() {
  return (
    <Stack spacing={3}>
      <ManualSection title="セキュリティと監査対応" subtitle="CareRecordは、日々の入力を便利にするだけでなく、介護記録を説明可能な証跡として残す運用を支えます。">
        <ManualDefinitionList
          items={[
            { term: '3省2ガイドラインを意識した証跡', description: '誰が、いつ、どの事業所で、どの記録や権限を操作したかを監査ログとして確認できる設計にします。問い合わせや監査時に説明しやすくなります。' },
            { term: 'アイドルタイムアウト', description: '共用端末や訪問先端末で画面を開いたまま離席した場合のリスクを下げます。ログインし直しにより、本人操作の前提を守ります。' },
            { term: '操作ログのCSVエクスポート', description: '承認、差戻し、権限変更、削除操作などをCSVで出力し、法人内の監査資料や事故調査の根拠として保全できます。' },
            { term: '論理削除と保持期限', description: '誤削除や監査対応に備え、すぐ物理削除せず削除状態・保持期限・バックアップの考え方を運用手順に組み込みます。' },
            { term: '最小権限', description: '一般スタッフには担当のみ、事務担当には必要な帳票・記録範囲だけを付与し、全体権限は管理者に限定します。' },
          ]}
        />
      </ManualSection>
      <ManualCallout tone="success" title="提案ポイント">紙やExcelでは「誰が変更したか」を後から追うのが難しくなります。CareRecordは操作ログ、権限、保持の考え方をセットにして、便利さと説明責任を両立します。</ManualCallout>
      <ManualDemo kind="logs" />
    </Stack>
  );
}

function TroubleshootingContent() {
  return (
    <Stack spacing={3}>
    <ManualSection title="困ったときの確認順" subtitle="現場で止まりやすいポイントを、原因の切り分け順に整理します。">
      <ManualDefinitionList
        items={[
          { term: '画面が見えない', description: '所属事業所、ロール、担当割当、ブラウザ更新を確認します。' },
          { term: '保存できない', description: '必須項目、時刻の前後関係、通信状態、権限、削除/アーカイブ状態を確認します。' },
          { term: 'AI取込が失敗する', description: 'ファイル形式、PDFの単独処理、画像グループ、文字の読み取り品質、処理中断を確認します。' },
          { term: 'シフトが同期されない', description: 'Google連携の認可切れ、未同期件数、対象月、キャンセル状態、手動変更済みシフトを確認します。' },
          { term: '帳票が合わない', description: '承認状態、記録日、シフト紐付け、内勤記録、削除状態、期間指定を確認します。' },
        ]}
      />
    </ManualSection>
    <ManualSection title="Googleカレンダー同期エラーの復旧フロー">
      <Stack spacing={1.5}>
        <ManualStep number={1} title="連携状態を見る" body="事業所設定のGoogleカレンダー連携が連携済みか確認します。認証切れの場合は、連携し直します。" />
        <ManualStep number={2} title="未同期を同期" body="未同期件数が表示されている場合は、まず「未同期を同期」を実行します。通常の復旧はこれで足ります。" />
        <ManualStep number={3} title="同期を修復" body="Google側で予定を削除した、カレンダー内容がずれている、未同期同期で解消しない場合は「同期を修復」で全体を再確認します。" />
      </Stack>
      <ManualCallout tone="warning" title="修復時の注意">手動調整済みシフトは上書き保護の対象です。同期修復はGoogleカレンダーとの整合性回復が目的で、CareRecord側の正しい予定を基準にします。</ManualCallout>
    </ManualSection>
    </Stack>
  );
}

function GlossaryContent() {
  return (
    <ManualSection title="用語集">
      <ManualDefinitionList
        items={[
          { term: '事業所', description: 'CareRecord 上でデータを分離する組織単位です。複数事業所に所属できます。' },
          { term: '利用者', description: '訪問介護記録、シフト、帳票の対象となる人です。' },
          { term: 'スタッフ', description: '名簿上の職員です。ログインアカウントとは別に管理されます。' },
          { term: 'アカウント', description: 'CareRecord にログインするユーザーです。ロールによって操作範囲が決まります。' },
          { term: 'ロール', description: '記録、シフト、内勤、管理機能の権限をまとめた設定です。' },
          { term: '担当のみ', description: '自分に割り当てられた利用者・シフト・記録だけを扱える権限範囲です。' },
          { term: 'ひな形', description: '繰り返しシフトを月次カレンダーへ展開するための基本パターンです。' },
          { term: '承認・差戻し', description: '管理者が記録内容を確認し、確定または修正依頼するための状態です。' },
          { term: '監査ログ', description: '誰がいつ何をしたかを追跡する操作履歴です。' },
          { term: 'バックアップ', description: '障害や監査対応に備えて保存されるデータ保全の仕組みです。' },
        ]}
      />
    </ManualSection>
  );
}
