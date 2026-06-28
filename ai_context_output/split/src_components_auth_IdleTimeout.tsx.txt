'use client';

// セッションのアイドルタイムアウト（3省2ガイドライン: 端末放置対策）。
// 一定時間無操作で警告し、さらに猶予を過ぎると自動ログアウトする。
// クライアント側の利便性のための実装であり、サーバー側 middleware による
// 最終アクティビティ検証（多層防御）と併用する。

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { heartbeatSession } from '@/app/actions/auth';
import { logoutCurrentUser } from '@/utils/clientLogout';
import { AppDialog } from '@/components/ui/AppDialog';
import { AppButton } from '@/components/ui/AppButton';

// 無操作からタイムアウト警告までの時間（ミリ秒）。既定24時間。
const IDLE_LIMIT_MS = 24 * 60 * 60 * 1000;
// 警告表示から自動ログアウトまでの猶予（ミリ秒）。
const WARNING_GRACE_MS = 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

export default function IdleTimeout() {
  const router = useRouter();
  const [warning, setWarning] = useState(false);
  const [remaining, setRemaining] = useState(Math.ceil(WARNING_GRACE_MS / 1000));
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const warningRef = useRef(false);
  // ログイン直後はCookie反映と画面遷移が並行するため、マウント直後のheartbeatを避ける。
  const lastHeartbeat = useRef<number | null>(null);

  const logout = useCallback(async () => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    await logoutCurrentUser();
    router.push('/?reason=idle_timeout');
  }, [router]);

  const startWarning = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (graceTimer.current) clearTimeout(graceTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    setRemaining(Math.ceil(WARNING_GRACE_MS / 1000));
    setWarning(true);
    countdownTimer.current = setInterval(() => {
      setRemaining((r) => (r > 0 ? r - 1 : 0));
    }, 1000);
    graceTimer.current = setTimeout(logout, WARNING_GRACE_MS);
  }, [logout]);

  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    const now = Date.now();
    if (lastHeartbeat.current === null) {
      lastHeartbeat.current = now;
    } else if (now - lastHeartbeat.current >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeat.current = now;
      // heartbeatは補助的な活動記録。通信失敗やCookie反映待ちをログアウトと同一視しない。
      // セッション失効の最終判定はProxy/Server Action側で行う。
      void heartbeatSession().catch((error) => {
        console.warn('session heartbeat failed', error);
      });
    }
    idleTimer.current = setTimeout(startWarning, IDLE_LIMIT_MS);
  }, [startWarning]);

  const stayActive = useCallback(() => {
    if (graceTimer.current) clearTimeout(graceTimer.current);
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    setWarning(false);
    resetIdle();
  }, [resetIdle]);

  useEffect(() => {
    warningRef.current = warning;
  }, [warning]);

  useEffect(() => {
    // 警告表示中はアクティビティで自動延長せず、明示操作のみ受け付ける。
    const onActivity = () => {
      if (!warningRef.current) resetIdle();
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    resetIdle();
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onActivity));
      if (idleTimer.current) clearTimeout(idleTimer.current);
      if (graceTimer.current) clearTimeout(graceTimer.current);
      if (countdownTimer.current) clearInterval(countdownTimer.current);
    };
  }, [resetIdle]);

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
