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
import ShiftGuideManual from '@/components/manual/ShiftGuideManual';

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
  { id: 'proposal', title: '提案書サマリー', subtitle: '目的・対象者・掲載方針', audience: '全員', icon: <MenuBookIcon /> },
  { id: 'start', title: '利用開始・ログイン', subtitle: '招待、参加、事業所切替', audience: '全員', icon: <LoginIcon /> },
  { id: 'common', title: '共通画面', subtitle: '上部バー、通知、サイドバー', audience: '全員', icon: <ChecklistIcon /> },
  { id: 'permissions', title: '権限とロール', subtitle: '全件・担当のみ・なし', audience: '管理者', icon: <AdminPanelSettingsIcon /> },
  { id: 'clients', title: '利用者管理', subtitle: '登録、担当、詳細設定', audience: '管理者', icon: <PeopleIcon /> },
  { id: 'form-settings', title: '記録フォーム設定', subtitle: '利用者ごとの入力項目', audience: '管理者', icon: <DescriptionIcon /> },
  { id: 'record', title: '記録作成', subtitle: 'シフト・利用者から記録', audience: 'スタッフ', icon: <EditNoteIcon /> },
  { id: 'ai-import', title: 'AI一括取込', subtitle: 'PDF/画像から記録候補を作成', audience: '管理者', icon: <AutoFixHighIcon /> },
  { id: 'internal-work', title: '内勤記録', subtitle: '訪問外業務の時間記録', audience: 'スタッフ', icon: <WorkHistoryIcon /> },
  { id: 'shifts', title: 'シフト管理', subtitle: 'ひな形、月次展開、PDF', audience: '管理者・スタッフ', icon: <CalendarMonthIcon /> },
  { id: 'reports', title: '提供記録一覧・帳票', subtitle: '承認、差戻し、出力', audience: '管理者', icon: <ArticleIcon /> },
  { id: 'statistics', title: '統計・予実管理', subtitle: '勤務、提供、差分確認', audience: '管理者', icon: <AnalyticsIcon /> },
  { id: 'staff', title: 'スタッフ管理', subtitle: '名簿、職種、担当', audience: '管理者', icon: <PersonIcon /> },
  { id: 'accounts', title: 'アカウント・権限管理', subtitle: '招待、ロール割当', audience: 'オーナー', icon: <KeyIcon /> },
  { id: 'settings', title: '事業所設定', subtitle: '基本情報、種別、連携', audience: 'オーナー', icon: <SettingsIcon /> },
  { id: 'logs-backup', title: 'ログ・バックアップ', subtitle: '監査、CSV、保全確認', audience: '管理者', icon: <BackupIcon /> },
  { id: 'security', title: 'セキュリティと運用', subtitle: 'ログイン、保持、削除', audience: '管理者', icon: <SecurityIcon /> },
  { id: 'troubleshooting', title: '困ったときは', subtitle: 'よくある問題と確認点', audience: '全員', icon: <HelpOutlineIcon /> },
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
  if (id === 'record') return <FeatureContent demo="record" title="記録作成" audience="スタッフ・管理者" related="自分のシフト、提供記録一覧、AI一括取込" points={['今日のシフトまたは利用者一覧から記録を作成します。', '日付、開始終了時刻、担当、利用者別フォームの入力を確認して保存します。', '下書きや差戻し記録は再編集でき、承認後の編集可否は権限に従います。']} />;
  if (id === 'ai-import') return <FeatureContent demo="ai" title="AI一括取込" audience="管理者・記録担当" related="記録作成、提供記録一覧" points={['PDF、JPEG、PNG、WebP を取り込み、AIが記録候補を抽出します。', '複数画像を1件にまとめる場合は、画像だけを選択してグループ化します。PDFは単独処理です。', '抽出結果は必ずレビューし、利用者・スタッフ・日時・本文を確認してから保存します。']} />;
  if (id === 'internal-work') return <FeatureContent demo="internalWork" title="内勤記録" audience="スタッフ・管理者" related="統計・予実管理、スタッフ管理" points={['訪問以外の電話対応、記録整理、事務作業などを時間として残します。', '自分の内勤記録を作成し、権限がある管理者は全体の状況を確認します。', '統計や労務集計に反映されるため、業務内容と時間を具体的に入力します。']} />;
  if (id === 'reports') return <FeatureContent demo="reports" title="提供記録一覧・帳票" audience="管理者" related="記録作成、シフト管理、統計" points={['全件、未承認・差戻し、今月の記録などの切り口で確認します。', '内容確認後に承認、差戻し、PDF出力を行います。', 'シフト紐付けがある記録は予実確認や月次帳票で利用します。']} />;
  if (id === 'permissions' || id === 'accounts') return <FeatureContent demo="roles" title={id === 'permissions' ? '権限とロール' : 'アカウント・権限管理'} audience="オーナー・管理者" related="スタッフ管理、事業所設定、ログ" points={['権限は「全件」「担当のみ」「なし」と、管理機能ごとの許可で構成されます。', '複数ロールを割り当てた場合、より強い権限が有効になります。', '招待、ロール変更、退職者対応は監査ログに残る前提で慎重に行います。']} />;
  if (id === 'logs-backup') return <FeatureContent demo="logs" title="ログ・バックアップ" audience="オーナー・管理者" related="セキュリティ、アカウント管理" points={['操作ログを日時、操作者、対象、結果で確認します。', 'CSVエクスポートは監査や問い合わせ対応の証跡として利用します。', 'バックアップ閲覧は保全状況の確認を目的とし、復元は運用手順に従って実施します。']} />;
  if (id === 'start') return <StartContent />;
  if (id === 'common') return <CommonContent />;
  if (id === 'statistics') return <TextOnlyContent title="統計・予実管理" audience="管理者" related="シフト管理、提供記録一覧、内勤記録" points={['スタッフ別・利用者別に提供時間、勤務時間、内勤時間を確認します。', 'シフト予定と実績記録の差分を確認し、未入力・時間不整合・承認漏れを発見します。', '集計値が想定と異なる場合は、対象期間、承認状態、シフト紐付け、削除状態を確認します。']} />;
  if (id === 'staff') return <TextOnlyContent title="スタッフ管理" audience="管理者" related="アカウント管理、利用者管理、シフト管理" points={['スタッフ名簿は、シフト担当、利用者担当、記録担当の候補として利用します。', 'ログインするアカウントとは別概念のため、名簿登録だけではログインできません。', '職種、稼働状況、担当利用者を整備することで、担当のみ権限の表示範囲が明確になります。']} />;
  if (id === 'settings') return <TextOnlyContent title="事業所設定" audience="オーナー・管理者" related="ロール管理、Google連携、シフト管理" points={['事業所基本情報、サービス種別、スタッフ役割、割増・労務設定を管理します。', 'Google連携はシフト同期に関係するため、認可切れや同期失敗の確認手順を記載します。', '事業所削除やオーナー移管は影響範囲が大きいため、権限者限定の重要操作として扱います。']} />;
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
      <ManualDemo kind="shifts" />
      <Divider />
      <ShiftGuideManual />
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
      <ManualSection title="セキュリティと運用">
        <ManualDefinitionList
          items={[
            { term: '認証', description: 'Supabase Auth によるメール/パスワードと Google OAuth を利用します。ログイン試行制限とパスワードポリシーを説明します。' },
            { term: '自動ログアウト', description: 'アイドルタイムアウトにより、共用端末での放置リスクを減らします。' },
            { term: '権限管理', description: '最小権限の原則で、一般スタッフには担当範囲のみ、管理者には必要な管理機能のみを付与します。' },
            { term: 'データ保持・削除', description: '記録は保持期間中保存され、削除申請や論理削除の考え方を運用手順として明記します。' },
          ]}
        />
      </ManualSection>
      <ManualDemo kind="logs" />
    </Stack>
  );
}

function TroubleshootingContent() {
  return (
    <ManualSection title="困ったときの確認順">
      <ManualDefinitionList
        items={[
          { term: '画面が見えない', description: '所属事業所、ロール、担当割当、ブラウザ更新を確認します。' },
          { term: '保存できない', description: '必須項目、時刻の前後関係、通信状態、権限、削除/アーカイブ状態を確認します。' },
          { term: 'AI取込が失敗する', description: 'ファイル形式、PDFの単独処理、画像グループ、文字の読み取り品質、処理中断を確認します。' },
          { term: 'シフトが同期されない', description: 'Google連携の認可、未同期件数、同期修復、対象月、キャンセル状態を確認します。' },
          { term: '帳票が合わない', description: '承認状態、記録日、シフト紐付け、内勤記録、削除状態、期間指定を確認します。' },
        ]}
      />
    </ManualSection>
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
