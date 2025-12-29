// lib/supabase.ts
import { createBrowserClient } from '@supabase/ssr';

// シングルトンとしてインスタンスを作成
export const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);