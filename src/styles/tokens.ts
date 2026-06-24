// src/styles/tokens.ts
//
// デザイントークン（単一の情報源 / Single Source of Truth）
//
// 色・角丸などのデザイン値はすべてここに集約する。
// このファイルは「フレームワーク非依存」の素の TypeScript オブジェクトであり、
//   - MUI テーマ        (src/theme.ts)           … palette / component override に展開
//   - PDF コンポーネント (@react-pdf/renderer)    … theme を参照できないため直接 import
//   - その他の任意のコード
// すべてがここを参照する。
//
// 新しい色を足すときは、まず既存トークンで代用できないか確認すること。
// コンポーネント側で hex を直書きしない（globals での再発防止ルール）。

/** ブランドカラー（メインの青系） */
export const brand = {
  /** メインカラー */
  primary: '#2255CC',
  /** プライマリの明るい変化形 */
  primaryLight: '#6699FF',
  /** プライマリの暗い変化形 / hover 強調 */
  primaryDark: '#003399',
} as const;

/** 青系の淡い背景・ティント（選択状態・ハイライト背景など） */
export const blueTint = {
  /** 最も淡い青背景 */
  50: '#F0F5FF',
  100: '#EEF2FF',
  150: '#E6F0FF',
  200: '#E3F2FD',
  300: '#D0E0FF',
  /** やや白寄りの青背景 */
  faint: '#F0F7FF',
  /** スレート系の淡い背景 */
  slate50: '#F8FAFC',
  slate200: '#E2E8F0',
  /** 罫線などに使う淡い青グレー */
  steel: '#B0C4DE',
} as const;

/** ニュートラル（グレー・サーフェス・ボーダー） */
export const neutral = {
  white: '#FFFFFF',
  /** アプリ全体の背景 */
  bg: '#F8F9FA',
  /** カード/パネルの薄いサーフェス */
  surface: '#F2F3F5',
  surfaceAlt: '#F0F2F5',
  surfaceSoft: '#F4F5F7',

  // グレースケール（明→暗）
  gray50: '#FAFAFA',
  gray60: '#FBFBFB',
  gray70: '#FCFCFC',
  gray75: '#F9F9F9',
  gray100: '#F5F5F5',
  gray150: '#F0F0F0',
  gray200: '#E0E0E0',
  gray300: '#D0D0D0',

  // ボーダー / 区切り線
  border: '#E3E5E8',
  borderAlt: '#EBEDEF',
  /** Google 系 UI でよく使うボーダー */
  borderGoogle: '#DADCE0',
} as const;

/** テキストカラー（濃→淡） */
export const text = {
  /** ほぼ黒の強調テキスト */
  strong: '#060607',
  /** 本文 */
  body: '#1A1A1A',
  /** ダークグレー（Google 系） */
  dark: '#3C4043',
  /** 別系統のダーク */
  darkAlt: '#2F2F2F',
  /** テーマの primary テキスト */
  primary: '#2C3E50',
  /** サブテキスト */
  secondary: '#5C5E66',
  /** テーマの secondary テキスト */
  secondaryAlt: '#636E72',
  /** さらに淡いミュート */
  muted: '#6D6F78',
} as const;

/** ステータスカラー（成功 / 警告 / エラー / 情報） */
export const status = {
  success: {
    main: '#23A559',
    alt: '#4CAF50',
    accent: '#81BC06',
    bg: '#E8F5E9',
    bgAlt: '#F1F8E9',
  },
  warning: {
    main: '#FF9800',
    accent: '#FFBA08',
    bg: '#FFF3E0',
    bgSoft: '#FFF8E1',
    bgFaint: '#FFFDE7',
    border: '#FFECB3',
    borderAlt: '#FFE0B2',
    highlight: '#FFF59D',
  },
  error: {
    main: '#FF1744',
    dark: '#D32F2F',
    bg: '#FFF5F5',
    bgAlt: '#FFEBEE',
    border: '#FFCDD2',
  },
  info: {
    /** 紫系の淡い背景 */
    purpleBg: '#F3E5F5',
  },
} as const;

/** 外部サービスのロゴ固有色（テーマ配色とは別管理 / 変更不可） */
export const brandExternal = {
  googleBlue: '#4285F4',
  googleRed: '#EA4335',
  googleYellow: '#FBBC05',
  googleGreen: '#34A853',
  microsoftRed: '#F35325',
  microsoftGreen: '#81BC06',
  microsoftBlue: '#05A6F0',
  microsoftYellow: '#FFBA08',
} as const;

/** 角丸 */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
} as const;

/** すべてのトークンをまとめたエクスポート（`import { tokens } from '...'` 用） */
export const tokens = {
  brand,
  blueTint,
  neutral,
  text,
  status,
  brandExternal,
  radius,
} as const;

export default tokens;
