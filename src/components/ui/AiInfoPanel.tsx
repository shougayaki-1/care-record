'use client';

import { useEffect, useState } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import SecurityIcon from '@mui/icons-material/Security';
import ListAltIcon from '@mui/icons-material/ListAlt';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';

type Props = {
  variant?: 'page' | 'dialog';
};

type SectionKey = 'about' | 'security' | 'steps' | 'cautions';

export function AiInfoPanel({ variant = 'page' }: Props) {
  const [expanded, setExpanded] = useState<SectionKey | false>(false);
  const [aiDestination, setAiDestination] = useState<string>('送信先のAIサービスを確認中です。');

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/ai/provider', { signal: controller.signal, cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('AI provider unavailable');
        return response.json() as Promise<{ provider: 'gemini' | 'openai'; model: string }>;
      })
      .then(({ provider, model }) => {
        setAiDestination(`読み取りには ${provider === 'openai' ? 'OpenAI' : 'Google Vertex AI'}（${model}）へファイルを送信します。`);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'AbortError') return;
        setAiDestination('送信先のAIサービスを表示できません。処理前に管理者へ確認してください。');
      });
    return () => controller.abort();
  }, []);

  const toggle = (key: SectionKey) =>
    setExpanded((prev) => (prev === key ? false : key));

  const bodyTypo = variant === 'dialog' ? '0.82rem' : '0.875rem';

  return (
    <Box sx={{ mb: variant === 'page' ? 3 : 1.5 }}>
      <Typography fontSize={bodyTypo} color="text.secondary" sx={{ mb: 1 }}>
        {aiDestination}
      </Typography>
      {/* 機能説明 */}
      <Accordion
        expanded={expanded === 'about'}
        onChange={() => toggle('about')}
        disableGutters
        elevation={0}
        sx={{ border: 1, borderColor: 'divider', '&:not(:last-child)': { borderBottom: 0 } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <AutoFixHighIcon color="primary" sx={{ mr: 1, fontSize: '1.1rem' }} />
          <Typography fontWeight={600} fontSize={variant === 'dialog' ? '0.875rem' : '0.9rem'}>
            この機能について
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <Typography fontSize={bodyTypo} color="text.secondary">
            紙の提供記録（手書き・印刷）の写真やPDFをアップロードするだけで、AIが自動的に記録の下書きを作成します。手入力の手間を大幅に削減できます。
          </Typography>
          <List dense disablePadding sx={{ mt: 1 }}>
            {[
              '対応形式: PDF・JPEG・PNG・WebP（1ファイル最大20MB）',
              'PDFは複数記録を自動検出して個別に取り込めます',
              '複数枚にまたがる記録は画像をグループ化して処理できます',
            ].map((text) => (
              <ListItem key={text} sx={{ py: 0.25, px: 0 }}>
                <ListItemIcon sx={{ minWidth: 24 }}>
                  <CheckCircleOutlineIcon fontSize="small" color="primary" />
                </ListItemIcon>
                <ListItemText primaryTypographyProps={{ fontSize: bodyTypo }} primary={text} />
              </ListItem>
            ))}
          </List>
        </AccordionDetails>
      </Accordion>

      {/* 安全性 */}
      <Accordion
        expanded={expanded === 'security'}
        onChange={() => toggle('security')}
        disableGutters
        elevation={0}
        sx={{ border: 1, borderColor: 'divider', '&:not(:last-child)': { borderBottom: 0 } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <SecurityIcon color="success" sx={{ mr: 1, fontSize: '1.1rem' }} />
          <Typography fontWeight={600} fontSize={variant === 'dialog' ? '0.875rem' : '0.9rem'}>
            安全性・プライバシー
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <List dense disablePadding>
            {[
              'アプリはアップロード元ファイルを記録データとして保存しません。',
              'AI取込の開始日時・操作したユーザー・ファイル数を監査ログに記録します。',
            ].map((text) => (
              <ListItem key={text} sx={{ py: 0.25, px: 0 }}>
                <ListItemIcon sx={{ minWidth: 24 }}>
                  <CheckCircleOutlineIcon fontSize="small" color="success" />
                </ListItemIcon>
                <ListItemText primaryTypographyProps={{ fontSize: bodyTypo }} primary={text} />
              </ListItem>
            ))}
          </List>
        </AccordionDetails>
      </Accordion>

      {/* 実行手順 */}
      <Accordion
        expanded={expanded === 'steps'}
        onChange={() => toggle('steps')}
        disableGutters
        elevation={0}
        sx={{ border: 1, borderColor: 'divider', '&:not(:last-child)': { borderBottom: 0 } }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <ListAltIcon color="action" sx={{ mr: 1, fontSize: '1.1rem' }} />
          <Typography fontWeight={600} fontSize={variant === 'dialog' ? '0.875rem' : '0.9rem'}>
            使い方
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <List dense disablePadding>
            {(variant === 'dialog'
              ? [
                  '① ファイルを選択（PDF・画像）',
                  '② 「処理開始」をクリック',
                  '③ AIの結果を確認・修正してから保存',
                ]
              : [
                  '① ファイルを選択またはドラッグ&ドロップ（PDF・JPEG・PNG・WebP）',
                  '② 複数画像が1件の記録の場合は「1記録としてまとめる」で結合',
                  '③ 「処理開始」をクリック — 結果がリアルタイムで追加されます',
                  '④ 各行で原本と全項目を照合し、誤りを修正して確認済みにする',
                  '⑤ 「下書き保存」で記録として保存',
                ]
            ).map((text) => (
              <ListItem key={text} sx={{ py: 0.25, px: 0 }}>
                <ListItemText primaryTypographyProps={{ fontSize: bodyTypo }} primary={text} />
              </ListItem>
            ))}
          </List>
        </AccordionDetails>
      </Accordion>

      {/* 注意点 */}
      <Accordion
        expanded={expanded === 'cautions'}
        onChange={() => toggle('cautions')}
        disableGutters
        elevation={0}
        sx={{ border: 1, borderColor: 'divider' }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <WarningAmberIcon color="warning" sx={{ mr: 1, fontSize: '1.1rem' }} />
          <Typography fontWeight={600} fontSize={variant === 'dialog' ? '0.875rem' : '0.9rem'}>
            注意点
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <List dense disablePadding>
            {[
              'AIの読み取り結果は必ず原本と照合してください。氏名・日付・時刻に加え、丸印やチェック欄も誤読することがあります。',
              'AI自己評価が「高」でも誤りは起こります。自己評価は保存可否の判断に使わないでください。',
              '手書きが薄い・汚れがある・傾きが大きいと読み取り精度が下がります。できるだけ明るく正面から撮影してください。',
              '記録の最終的な正確性を確認する責任はスタッフにあります。AIによる下書きはあくまで補助です。',
            ].map((text) => (
              <ListItem key={text} sx={{ py: 0.25, px: 0 }}>
                <ListItemIcon sx={{ minWidth: 24 }}>
                  <WarningAmberIcon fontSize="small" color="warning" />
                </ListItemIcon>
                <ListItemText primaryTypographyProps={{ fontSize: bodyTypo }} primary={text} />
              </ListItem>
            ))}
          </List>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
}
