/**
 * 記録詳細画面 (`/app/record/[clientId]`) への遷移先URLを組み立てる。
 *
 * draftKey をこの時点で発行してURLに含めることで、遷移先マウント時の
 * URL正規化用 router.replace() が発火しないようにする。Next.js App Router は
 * 保留中の router.push が実ブラウザ履歴へコミットされる前に router.replace が
 * 発火すると、そのpushを履歴に残さず上書きしてしまう（ブラウザ「戻る」が
 * 直前の一覧画面を飛ばして2つ前の画面に戻る）ため、pushと競合するreplaceを
 * そもそも発生させないことで回避する。
 */
export function buildRecordPath(clientId: string, params?: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) query.set(key, value);
    }
  }
  query.set('draftKey', crypto.randomUUID());
  return `/app/record/${clientId}?${query.toString()}`;
}
