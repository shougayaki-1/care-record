'use client';

// セッションのアイドルタイムアウト（3省2ガイドライン: 端末放置対策）。
// 一定時間無操作で警告し、さらに猶予を過ぎると自動ログアウトする。
// クライアント側の利便性のための実装であり、サーバー側 middleware による
// 最終アクティビティ検証（多層防御）と併用する。

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { recordLogout } from '@/app/actions/auth';
import { AppDialog } from '@/components/ui/AppDialog';
import { AppButton } from '@/components/ui/AppButton';

// 無操作からタイムアウト警告までの時間（ミリ秒）。既定15分。
const IDLE_LIMIT_MS = 15 * 60 * 1000;
// 警告表示から自動ログアウトまでの猶予（ミリ秒）。
const WARNING_GRACE_MS = 60 * 1000;
// アクティビティCookieとmiddlewareの閾値を合わせるためのCookie名。
const ACTIVITY_COOKIE = 'cr_last_activity';

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

function setActivityCookie() {
  // middleware が参照する最終アクティビティ時刻。HttpOnlyにはできない（JS更新のため）。
  document.cookie = `${ACTIVITY_COOKIE}=${Date.now()}; path=/; SameSite=Lax`;
}

export default function IdleTimeout() {
  const router = useRouter();
  const [warning, setWarning] = useState(false);
  const [remaining, setRemaining] = useState(Math.ceil(WARNING_GRACE_MS / 1000));
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const logout = useCallback(async () => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    await recordLogout();
    await supabase.auth.signOut();
    router.push('/?reason=idle_timeout');
  }, [router]);

  const startWarning = useCallback(() => {
    setRemaining(Math.ceil(WARNING_GRACE_MS / 1000));
    setWarning(true);
    countdownTimer.current = setInterval(() => {
      setRemaining((r) => (r > 0 ? r - 1 : 0));
    }, 1000);
    graceTimer.current = setTimeout(logout, WARNING_GRACE_MS);
  }, [logout]);

  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    setActivityCookie();
    idleTimer.current = setTimeout(startWarning, IDLE_LIMIT_MS);
  }, [startWarning]);

  const stayActive = useCallback(() => {
    if (graceTimer.current) clearTimeout(graceTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    setWarning(false);
    resetIdle();
  }, [resetIdle]);

  useEffect(() => {
    // 警告表示中はアクティビティで自動延長せず、明示操作のみ受け付ける。
    const onActivity = () => {
      if (!warning) resetIdle();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    resetIdle();
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (graceTimer.current) clearTimeout(graceTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
    // warning の変化で活動リスナーの挙動を切り替える。
  }, [warning, resetIdle]);

  return (
    <AppDialog
      open={warning}
      disableEscapeKeyDown
      maxWidth="xs"
      title="まもなく自動ログアウトします"
      actions={
        <AppButton onClick={stayActive} intent="primary">
          ログインを継続する
        </AppButton>
      }
    >
      操作がないため、あと {remaining} 秒で安全のため自動的にログアウトします。
      続ける場合は「ログインを継続する」を押してください。
    </AppDialog>
  );
}
