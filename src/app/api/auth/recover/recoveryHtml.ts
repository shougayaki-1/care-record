/** Standalone presentation shared with browser stories; no framework or external assets. */
export function recoveryHtml(completed: boolean, nonce: string, script = ''): string {
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${completed ? 'ログアウトしました' : 'CareRecordの復旧'} | CareRecord</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: clamp(.75rem, 4vw, 1.5rem);
    font-family: "Helvetica Neue", Arial, sans-serif;
    font-size: 1rem;
    line-height: 1.7;
    color: CanvasText;
    background: ButtonFace;
    overflow-wrap: anywhere;
  }
  main {
    width: 100%;
    max-width: 28rem;
    min-width: 0;
    padding: clamp(1rem, 5vw, 2.5rem);
    border: 1px solid GrayText;
    border-radius: 8px;
    background: Canvas;
    text-align: center;
  }
  .brand {
    margin: 0 0 2rem;
    color: LinkText;
    font-size: clamp(1.5rem, 7vw, 2rem);
    font-weight: 700;
    letter-spacing: -.02em;
    line-height: 1.3;
  }
  h1 {
    margin: 0 0 1rem;
    font-size: clamp(1.25rem, 5vw, 1.5rem);
    font-weight: 700;
    line-height: 1.5;
  }
  .description { margin: 0 0 1.5rem; }
  form, .actions { margin: 0; }
  .primary-action {
    display: block;
    width: 100%;
    min-height: 48px;
    padding: .75rem 1rem;
    border: 1px solid LinkText;
    border-radius: 8px;
    font: inherit;
    font-weight: 600;
    line-height: 1.5;
    white-space: normal;
    overflow-wrap: anywhere;
    color: Canvas;
    background: LinkText;
    text-align: center;
    text-decoration: none;
    cursor: pointer;
  }
  .primary-action:hover { text-decoration: underline; }
  .primary-action:focus-visible {
    outline: 3px solid CanvasText;
    outline-offset: 3px;
  }
</style>
</head><body><main aria-labelledby="recovery-title">
<p class="brand">CareRecord</p>
<h1 id="recovery-title">${completed ? 'ログアウトしました' : 'CareRecordの復旧'}</h1>
${completed ? '<p class="description">ログイン画面へ戻ります。</p><p class="actions"><a class="primary-action" href="/">ログイン画面へ戻る</a></p>' :
  '<p class="description">画面が表示されない場合や別のアカウントで入り直す場合は、ログアウトしてやり直してください。</p><form action="/api/auth/recover" method="post"><button class="primary-action" type="submit">ログアウトしてやり直す</button></form>'}
</main>${script}</body></html>`;
}
