import { cookies } from 'next/headers';
import { PasswordRecoveryForm } from '@/components/auth/PasswordRecoveryForm';
import { RECOVERY_GRANT_COOKIE } from '@/utils/passwordRecovery';
import { getAuthedUser } from '@/utils/supabase/auth';

export const dynamic = 'force-dynamic';
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  let validLink = Boolean((await cookies()).get(RECOVERY_GRANT_COOKIE)?.value) && !(await searchParams).error;
  if (validLink) {
    try { await getAuthedUser(); } catch { validLink = false; }
  }
  return <PasswordRecoveryForm mode="reset" validLink={validLink} />;
}
