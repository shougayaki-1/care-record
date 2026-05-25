'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

/**
 * ログイン中ユーザーの状態（セッション情報）を取得し、監視するカスタムフックです。
 * @returns { user: User | null, loading: boolean }
 */
export function useCurrentUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    // 初回のユーザー情報を取得
    supabase.auth.getUser().then(({ data, error }) => {
      if (mounted) {
        if (!error && data.user) {
          setUser(data.user);
        }
        setLoading(false);
      }
    });

    // 認証セッションの変更（サインイン・サインアウト）を検知・同期
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return { user, loading };
}