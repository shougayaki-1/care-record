'use client';

import { Box, Card, CardContent, Divider, Typography, Button, TextField, Alert, Accordion, AccordionSummary, AccordionDetails, Tooltip, Chip, Stack } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import DescriptionIcon from '@mui/icons-material/Description';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import CopyAllIcon from '@mui/icons-material/CopyAll';
import CircularProgress from '@mui/material/CircularProgress';

import { FormItem } from '@/constants/formTemplates';
import { convertSchemaToReadable, FormItem as HelperFormItem } from '@/utils/templateHelper';

type Props = {
    templateId: string;
    setTemplateId: (val: string) => void;
    formItems: FormItem[];
    isCreatingTemplate: boolean;
    handleCreateTemplate: () => Promise<void>;
    showToast: (msg: string, severity?: 'success' | 'error' | 'info') => void;
};

export function GoogleDocsTab({ templateId, setTemplateId, formItems, isCreatingTemplate, handleCreateTemplate, showToast }: Props) {
    const copyTag = (text: string) => {
        navigator.clipboard.writeText(text);
        showToast(`コピーしました: ${text}`, 'success');
    };

    const renderTagList = () => {
        const readableItems = convertSchemaToReadable(formItems);
        const groups: { title: string, items: HelperFormItem[] }[] = [];
        let currentGroup = { title: '基本・その他', items: [] as HelperFormItem[] };

        readableItems.forEach(item => {
            if (item.type === 'section') {
                if (currentGroup.items.length > 0) groups.push(currentGroup);
                currentGroup = { title: item.label, items: [] };
            } else {
                currentGroup.items.push(item);
            }
        });
        if (currentGroup.items.length > 0) groups.push(currentGroup);

        return groups;
    };

    const handleCopyAllTags = () => {
        const groups = renderTagList();
        let allTagsText = "";
        
        groups.forEach(group => {
            allTagsText += `\n■ ${group.title}\n`;
            group.items.forEach((item: HelperFormItem) => {
                if (['checkbox', 'text', 'number', 'time'].includes(item.type)) {
                    allTagsText += `${item.label}: {{${item.id}}}\n`;
                    if (item.hasDetail) allTagsText += `  └ 詳細: {{${item.id}_詳細}}\n`;
                } else if (['multicheckbox', 'select'].includes(item.type)) {
                    allTagsText += `▼ ${item.label}\n`;
                    const options = item.options?.split(',') || [];
                    options.forEach((opt: string) => {
                        allTagsText += `${opt.trim()}: {{${item.id}_${opt.trim()}}}  `;
                    });
                    allTagsText += "\n";
                    if (item.hasDetail) allTagsText += `  (詳細/他: {{${item.id}_詳細}})\n`;
                }
            });
        });
        
        allTagsText += "\n■ 共通項目\n";
        ['利用者名', '担当ヘルパー名', '開始日付', '開始時刻', '終了日付', '終了時刻', 'サービス時間', '移動時間'].forEach(key => {
            allTagsText += `${key}: {{${key}}}\n`;
        });

        navigator.clipboard.writeText(allTagsText);
        showToast("全てのタグをコピーしました", 'success');
    };

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
                        <Typography variant="subtitle2" fontWeight="bold" display="flex" alignItems="center" gap={1} mb={1}>
                            <AutoFixHighIcon color="secondary" fontSize="small" /> 1. テンプレートを作成・連携
                        </Typography>
                        <Typography variant="body2" color="text.secondary" paragraph>
                            マスターテンプレート（共通のひな形）をコピーして、この利用者専用のGoogleドキュメントを作成します。<br/>
                            作成後、下記リストから必要なタグをコピーしてドキュメントに貼り付け、レイアウトを調整してください。
                        </Typography>
                        
                        <Button 
                            variant="contained" 
                            color="secondary" 
                            onClick={handleCreateTemplate} 
                            disabled={isCreatingTemplate || formItems.length === 0}
                            startIcon={isCreatingTemplate ? <CircularProgress size={20} color="inherit" /> : <AddCircleIcon />}
                        >
                            {isCreatingTemplate ? '作成中...' : 'テンプレートを新規作成する'}
                        </Button>
                        
                        <Box mt={2.5}>
                            <Typography variant="caption" color="text.secondary" fontWeight="bold">ID手動設定:</Typography>
                            <TextField 
                                size="small"
                                fullWidth
                                value={templateId} 
                                onChange={(e) => setTemplateId(e.target.value)} 
                                placeholder="作成済みのGoogleドキュメントIDがあればここに入力" 
                                sx={{ mt: 0.5 }}
                            />
                        </Box>
                    </Box>

                    <Divider />

                    <Box mt={3}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
                            <Typography variant="subtitle2" fontWeight="bold" display="flex" alignItems="center" gap={1}>
                                <ContentPasteIcon color="primary" fontSize="small" /> 2. 利用可能な差し込みタグ一覧
                            </Typography>
                            <Button 
                                variant="outlined" 
                                size="small" 
                                startIcon={<CopyAllIcon />} 
                                onClick={handleCopyAllTags}
                            >
                                全てのタグをコピー
                            </Button>
                        </Stack>
                        <Alert severity="info" sx={{ mb: 2 }}>
                            クリックするとタグをコピーできます。Googleドキュメントの表の中に貼り付けてください。<br/>
                            データが存在する場合、タグの部分が ☑︎ やテキストに置き換わります。
                        </Alert>

                        {renderTagList().map((group, gIdx) => (
                            <Accordion key={gIdx} defaultExpanded={gIdx === 0}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: '#f8f9fa' }}>
                                    <Typography fontWeight="bold" fontSize="0.9rem">{group.title}</Typography>
                                </AccordionSummary>
                                <AccordionDetails>
                                    <Box display="flex" flexWrap="wrap" gap={1}>
                                        {group.items.map(item => {
                                            if (['checkbox', 'text', 'number', 'time'].includes(item.type)) {
                                                const tag = `{{${item.id}}}`;
                                                const detailTag = item.hasDetail ? `{{${item.id}_詳細}}` : null;
                                                return (
                                                    <Box key={item.id} display="flex" gap={1} alignItems="center">
                                                        <Tooltip title="クリックしてコピー">
                                                            <Chip label={`${item.label}: ${tag}`} onClick={() => copyTag(tag)} clickable size="small" />
                                                        </Tooltip>
                                                        {detailTag && (
                                                            <Tooltip title="詳細入力のタグ">
                                                                <Chip label={`詳細: ${detailTag}`} onClick={() => copyTag(detailTag)} clickable size="small" variant="outlined" />
                                                            </Tooltip>
                                                        )}
                                                    </Box>
                                                );
                                            }
                                            if (['multicheckbox', 'select'].includes(item.type)) {
                                                const options = item.options?.split(',') || [];
                                                return (
                                                    <Box key={item.id} width="100%" sx={{ p: 1, border: '1px dashed #ddd', borderRadius: 1 }}>
                                                        <Typography variant="caption" display="block" mb={0.5} fontWeight="bold">{item.label}</Typography>
                                                        <Box display="flex" flexWrap="wrap" gap={1}>
                                                            {options.map((opt: string) => {
                                                                const cleanOpt = opt.trim();
                                                                const tag = `{{${item.id}_${cleanOpt}}}`;
                                                                return (
                                                                    <Tooltip key={cleanOpt} title="クリックしてコピー">
                                                                        <Chip label={`${cleanOpt}: ${tag}`} onClick={() => copyTag(tag)} clickable size="small" />
                                                                    </Tooltip>
                                                                );
                                                            })}
                                                            {item.hasDetail && (
                                                                <Tooltip title="詳細/その他のタグ">
                                                                    <Chip label={`詳細: {{${item.id}_詳細}}`} onClick={() => copyTag(`{{${item.id}_詳細}}`)} clickable size="small" variant="outlined" />
                                                                </Tooltip>
                                                            )}
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
                            <AccordionSummary expandIcon={<ExpandMoreIcon />} sx={{ bgcolor: '#f8f9fa' }}>
                                <Typography fontWeight="bold" fontSize="0.9rem">共通項目（日付・ヘルパー名など）</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Box display="flex" flexWrap="wrap" gap={1}>
                                    {['利用者名', '担当ヘルパー名', '開始日付', '開始時刻', '終了日付', '終了時刻', 'サービス時間', '移動時間'].map(key => (
                                        <Tooltip key={key} title="クリックしてコピー">
                                            <Chip label={`{{${key}}}`} onClick={() => copyTag(`{{${key}}}`)} clickable color="primary" variant="outlined" size="small" />
                                        </Tooltip>
                                    ))}
                                </Box>
                            </AccordionDetails>
                        </Accordion>
                    </Box>
                </CardContent>
            </Card>
        </Stack>
    );
}