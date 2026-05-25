'use server';

import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { ActionResponse } from '@/types';

type OrgRow = {
    id: string;
    name: string;
    created_at: string;
    profiles: { count: number }[];
    clients: { count: number }[];
};

type FormattedOrg = {
    id: string;
    name: string;
    createdAt: string;
    staffCount: number;
    clientCount: number;
};

async function requireSuperAdmin(): Promise<string> {
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

    const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();

    if (profile?.role !== 'super_admin') {
        throw new Error('システム管理者（Super Admin）権限が必要です。');
    }
    return user.id;
}

export async function getAllOrganizations(): Promise<ActionResponse<FormattedOrg[]>> {
    try {
        await requireSuperAdmin();

        const { data, error } = await supabaseAdmin
            .from('organizations')
            .select(`
                id,
                name,
                created_at,
                profiles (count),
                clients (count)
            `)
            .order('created_at', { ascending: false });

        if (error) throw new Error(error.message);

        const orgs = data as unknown as OrgRow[];

        const formatted = orgs.map((org) => ({
            id: org.id,
            name: org.name,
            createdAt: org.created_at,
            staffCount: org.profiles[0]?.count || 0,
            clientCount: org.clients[0]?.count || 0,
        }));

        return { status: 'success', data: formatted };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'error', message };
    }
}

export async function deleteOrganization(orgId: string): Promise<ActionResponse<{ success: boolean }>> {
    try {
        await requireSuperAdmin();

        const { error } = await supabaseAdmin
            .from('organizations')
            .delete()
            .eq('id', orgId);

        if (error) throw new Error(error.message);
        return { status: 'success', data: { success: true } };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { status: 'error', message };
    }
}