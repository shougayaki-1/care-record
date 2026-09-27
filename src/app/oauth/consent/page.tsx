import { redirect } from 'next/navigation';
import { createSessionClient, getAuthedUser } from '@/utils/supabase/auth';
import { decideMcpAuthorization } from './actions';

export const dynamic = 'force-dynamic';

export default async function McpConsentPage({
  searchParams,
}: {
  searchParams: Promise<{ authorization_id?: string }>;
}) {
  const { authorization_id: authorizationId } = await searchParams;
  if (!authorizationId || !/^[a-zA-Z0-9_-]{1,512}$/.test(authorizationId)) {
    return <main className="mx-auto max-w-lg p-8">接続リクエストが見つかりません。</main>;
  }

  try {
    await getAuthedUser();
  } catch {
    redirect(`/?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);
  }

  const supabase = await createSessionClient();
  const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) {
    return <main className="mx-auto max-w-lg p-8">接続リクエストを確認できませんでした。最初から接続をやり直してください。</main>;
  }
  if (!('authorization_id' in data)) redirect(data.redirect_url);

  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="mb-4 text-2xl font-bold">AIアプリとの接続を確認</h1>
      <p className="mb-5">{data.client.name} が CareRecord の読み取り候補機能に接続しようとしています。</p>
      <dl className="mb-5 rounded border p-4 text-sm">
        <dt className="font-semibold">接続先</dt>
        <dd className="mb-3 break-all">{data.redirect_uri}</dd>
        <dt className="font-semibold">要求された権限</dt>
        <dd>{data.scope?.trim() || '基本的な接続'}</dd>
      </dl>
      <p className="mb-6 text-sm">
        接続したAIは、所属事業所とフォームを確認し、PDFの読み取り結果を「要確認の候補」として送信できます。
        記録の確定はアプリで原本を確認した後に行います。PDFや画像をAIへ添付すると、そのデータは接続先のAIサービスに送られます。
        接続はアプリの「AIアプリとの接続」から解除できます。
      </p>
      <form action={decideMcpAuthorization} className="flex gap-3">
        <input type="hidden" name="authorization_id" value={authorizationId} />
        <button type="submit" name="decision" value="approve" className="rounded bg-blue-700 px-5 py-2 text-white">接続を許可</button>
        <button type="submit" name="decision" value="deny" className="rounded border px-5 py-2">許可しない</button>
      </form>
    </main>
  );
}
