// src/utils/authCheck.ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export type OrganizationRole = 'owner' | 'manager' | 'staff';

export async function requireOrgMember(organizationId: string, minRole?: OrganizationRole): Promise<string> {
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
            // ★ローカル環境（http://localhost）でのCookie書き込み拒否を回避するための修正
            cookiesToSet.forEach(({ name, value, options }) => {
              const finalOptions = {
                ...options,
                secure: process.env.NODE_ENV === 'development' ? false : options.secure,
              };
              cookieStore.set(name, value, finalOptions);
            });
          } catch {
            // Server Component 内でのCookie同期エラーを安全に無視
          }
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    throw new Error('セッションが切れています。再度ログインしてください。');
  }

  const { data: member, error } = await supabaseAdmin
    .from('organization_members')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', user.id)
    .single();

  if (error || !member) {
    throw new Error('この事業所のデータへのアクセス権限がありません。');
  }

  if (minRole) {
    const roles: OrganizationRole[] = ['staff', 'manager', 'owner'];
    const currentIdx = roles.indexOf(member.role as OrganizationRole);
    const targetIdx = roles.indexOf(minRole);

    if (currentIdx < targetIdx) {
      throw new Error(`この操作を実行するための権限（最小必要要件: ${minRole}）がありません。`);
    }
  }

  return user.id;
}