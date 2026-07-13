'use client';

import AddCircleIcon from '@mui/icons-material/AddCircle';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import CopyAllIcon from '@mui/icons-material/CopyAll';
import DescriptionIcon from '@mui/icons-material/Description';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import type { FormItem } from '@/constants/formTemplates';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@/components/ui/mui';

type TagGroup = { title: string; items: FormItem[] };

type Props = {
  templateId: string;
  setTemplateId: (value: string) => void;
  isCreatingTemplate: boolean;
  hasFormItems: boolean;
  onCreateTemplate: () => void;
  onCopyAllTags: () => void;
  onCopyTag: (tag: string) => void;
  tagGroups: TagGroup[];
};

const COMMON_TAGS = ['利用者名', '担当ヘルパー名', '開始日付', '開始時刻', '終了日付', '終了時刻', 'サービス時間', '移動時間'];

export function IntegrationsTab({
  templateId,
  setTemplateId,
  isCreatingTemplate,
  hasFormItems,
  onCreateTemplate,
  onCopyAllTags,
  onCopyTag,
  tagGroups,
}: Props) {
  return (
    <Stack spacing={3}>
      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" alignItems="center" gap={2} mb={2}>
            <DescriptionIcon color="primary" fontSize="large" />
            <Box>
              <Typography variant="h6" fontWeight="bold">Googleドキュメント連携</Typography>
              <Typography variant="body2" color="text.secondary">帳票の雛形（テンプレート）を管理します。</Typography>
            </Box>
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Box mb={4}>
            <Typography variant="subtitle2" fontWeight="bold" gutterBottom display="flex" alignItems="center" gap={1}>
              <AutoFixHighIcon color="secondary" fontSize="small" /> 1. テンプレートを作成・連携
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              マスターテンプレート（共通のひな形）をコピーして、この利用者専用のGoogleドキュメントを作成します。<br />
              作成後、下記リストから必要なタグをコピーしてドキュメントに貼り付け、レイアウトを調整してください。
            </Typography>
            <Button variant="contained" color="secondary" onClick={onCreateTemplate} disabled={isCreatingTemplate || !hasFormItems} startIcon={isCreatingTemplate ? <CircularProgress size={20} color="inherit" /> : <AddCircleIcon />}>
              {isCreatingTemplate ? '作成中...' : 'テンプレートを新規作成する'}
            </Button>
            <Box mt={2}>
              <Typography variant="caption" color="text.secondary">ID手動設定:</Typography>
              <TextField size="small" fullWidth value={templateId} onChange={(event) => setTemplateId(event.target.value)} placeholder="作成済みのGoogleドキュメントIDがあればここに入力" sx={{ mt: 0.5 }} />
            </Box>
          </Box>
          <Divider />
          <Box mt={3}>
            <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="subtitle2" fontWeight="bold" display="flex" alignItems="center" gap={1}>
                <ContentPasteIcon color="primary" fontSize="small" /> 2. 利用可能な差し込みタグ一覧
              </Typography>
              <Button variant="outlined" size="small" startIcon={<CopyAllIcon />} onClick={onCopyAllTags}>全てのタグをコピー</Button>
            </Stack>
            <Alert severity="info" sx={{ mb: 2 }}>
              クリックするとタグをコピーできます。Googleドキュメントの表の中に貼り付けてください。<br />
              データが存在する場合、タグの部分が ☑︎ やテキストに置き換わります。
            </Alert>
            {tagGroups.map((group, groupIndex) => (
              <Accordion key={group.title} defaultExpanded={groupIndex === 0}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: 'background.muted' }}>
                  <Typography fontWeight="bold">{group.title}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <Box display="flex" flexWrap="wrap" gap={1}>
                    {group.items.map((item) => {
                      if (['checkbox', 'text', 'number', 'time'].includes(item.type)) {
                        const tag = `{{${item.id}}}`;
                        const detailTag = item.hasDetail ? `{{${item.id}_詳細}}` : null;
                        return (
                          <Box key={item.id} display="flex" gap={1} alignItems="center">
                            <Tooltip title="クリックしてコピー"><Chip label={`${item.label}: ${tag}`} onClick={() => onCopyTag(tag)} clickable /></Tooltip>
                            {detailTag && <Tooltip title="詳細入力のタグ"><Chip label={`詳細: ${detailTag}`} onClick={() => onCopyTag(detailTag)} clickable size="small" variant="outlined" /></Tooltip>}
                          </Box>
                        );
                      }
                      if (['multicheckbox', 'select'].includes(item.type)) {
                        const options = item.options?.split(',') || [];
                        return (
                          <Box key={item.id} width="100%" sx={{ p: 1, border: '1px dashed', borderColor: 'divider', borderRadius: 1 }}>
                            <Typography variant="caption" display="block" mb={0.5} fontWeight="bold">{item.label}</Typography>
                            <Box display="flex" flexWrap="wrap" gap={1}>
                              {options.map((option) => {
                                const cleanOption = option.trim();
                                const tag = `{{${item.id}_${cleanOption}}}`;
                                return <Tooltip key={cleanOption} title="クリックしてコピー"><Chip label={`${cleanOption}: ${tag}`} onClick={() => onCopyTag(tag)} clickable size="small" /></Tooltip>;
                              })}
                              {item.hasDetail && <Tooltip title="詳細/その他のタグ"><Chip label={`詳細: {{${item.id}_詳細}}`} onClick={() => onCopyTag(`{{${item.id}_詳細}}`)} clickable size="small" variant="outlined" /></Tooltip>}
                            </Box>
                          </Box>
                        );
                      }
                      return null;
                    })}
                  </Box>
                </AccordionDetails>
              </Accordion>
            ))}
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: 'background.muted' }}>
                <Typography fontWeight="bold">共通項目（日付・ヘルパー名など）</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box display="flex" flexWrap="wrap" gap={1}>
                  {COMMON_TAGS.map((key) => <Tooltip key={key} title="クリックしてコピー"><Chip label={`{{${key}}}`} onClick={() => onCopyTag(`{{${key}}}`)} clickable color="primary" variant="outlined" /></Tooltip>)}
                </Box>
              </AccordionDetails>
            </Accordion>
          </Box>
        </CardContent>
      </Card>
    </Stack>
  );
}
