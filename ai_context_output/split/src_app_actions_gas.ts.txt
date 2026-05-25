'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { requireOrgMember } from '@/utils/authCheck';

const GAS_API_URL = process.env.NEXT_PUBLIC_GAS_API_URL!;

export async function callGasApi(payload: Record<string, unknown>) {
  if (!GAS_API_URL) throw new Error('GAS_API_URL is not defined');

  // 最低限ログインしているセッション状態を確認
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // エラー無視しつつCookieを同期
          }
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('認証が必要です。');

  // payloadに事業者IDが明確に含まれている場合、対象組織の権限(manager以上)を検証
  if (payload.orgId && typeof payload.orgId === 'string') {
      await requireOrgMember(payload.orgId, 'manager');
  }

  try {
    const response = await fetch(GAS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      // GASのリダイレクトを追跡する
      redirect: 'follow', 
    });

    if (!response.ok) {
        throw new Error(`GAS API responded with status ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('GAS Action Error:', error);
    return { status: 'error', message: String(error) };
  }
}