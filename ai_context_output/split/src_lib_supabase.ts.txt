// src/lib/supabase.ts
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 1. サーバーサイドでの静的ビルド（Prerendering）フェーズであり、かつ環境変数がない状況かを厳密に判定
// 2. この条件に合致する場合のみ、一時的にダミー文字列を渡して初期化時の例外クラッシュを回避します
const isBuildPhase = typeof window === 'undefined' && (!supabaseUrl || !supabaseAnonKey);

export const supabase = createBrowserClient(
    isBuildPhase ? 'https://placeholder-url.supabase.co' : (supabaseUrl || ''),
    isBuildPhase ? 'placeholder-anon-key' : (supabaseAnonKey || '')
);