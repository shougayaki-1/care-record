# Codex Continuous Worker

[Issue #56](https://github.com/shougayaki-1/care-record/issues/56) の最新本文に従うローカル常駐 worker。利用可能な間は1件ずつ実装し、利用上限に達すると待機して同じ Issue から再開します。固定の3時間稼働・2時間休止は使いません。

## セットアップ

Node.js 24、Git、GitHub CLI、Codex CLI を用意します。実行用の専用 OS ユーザーと専用 clone を使い、本番データ・本番資格情報・個人用の `.env.local` を置かないでください。Issue の本文・添付・参照先にも秘密値や PHI を含めず、人が内容を確認した Issue にだけ `codex:ready` を付けます。

```sh
npm install -g @openai/codex
codex --version
codex exec --help
codex exec resume --help
codex login
gh auth login
gh auth status
git clone https://github.com/shougayaki-1/care-record.git care-record-worker
cd care-record-worker
npm ci
```

Codex はブラウザから ChatGPT アカウントでログインします。API key login は使いません。Git の author は専用 clone の local config（`git config --local user.name` / `user.email`）に設定し、`git push` が非対話で認証できることも確認してください。ローカル commit はユーザーの global Git config を継承しません。必要なら `gh auth setup-git` を実行します。Codex のユーザー設定には、リポジトリで必須の Context7 MCP を設定しておきます。認証・MCP 設定を repository や worker state にコピーしません。

初回に次のラベルを GitHub の画面または `gh label create` で作ります。worker はラベルを自動作成しません。

- `codex:ready` / `codex:running` / `codex:blocked`
- `codex:failed` / `codex:needs-human`
- `priority:p0` / `priority:p1` / `priority:p2` / `priority:p3`

`codex:bootstrap` は実装対象を示すキューラベルではありません。#56 自体を自動選択する必要はありません。

## キュー

open かつ `codex:ready` の Issue を選びます。blocked / running / failed / needs-human、open PR が参照している Issue、未解決依存のある Issue は除外します。PR の head が `codex/issue-<number>-...` の場合も除外します。Issue timeline の cross-reference を確認するため、closing keyword のない関連 PR も対象になります。

```md
<!-- codex-queue
priority: p1
depends_on: [39]
-->
```

metadata の priority を優先し、省略時は priority label、さらに省略時は最後の優先度にします。同順位は Issue 番号順です。依存 Issue は closed の場合だけ選択できます。不正な metadata、存在しない依存 Issue は自動実装を開始しません。依存先が closed でも PR が未 merge の場合は、その実装が main にあることを人が確認してください。

1 repository につき worker は1つだけ運用します。ローカル state の排他 lock は同じ state directory を使うプロセスの二重起動を防ぎます。GitHub のラベル更新は分散 lock ではないので、別ホスト・別 state directory で並行起動しません。

## コマンド

```sh
npm run codex:worker:dry-run
npm run codex:worker:status
npm run codex:worker:once
npm run codex:worker
```

dry-run は read-only の GitHub API と origin 確認だけを使い、Issue 番号、依存関係、branch、予定コマンドを表示します。fetch / worktree 作成 / Codex 実行 / ラベル変更 / state 作成は行いません。保存済みの中断 Issue があれば、その Issue を表示します。status は GitHub/Codex を呼ばず state を表示します。`nextRetryAt` と `quotaWaitStarted` は Unix milliseconds です。

once は1 Issue を処理します。同じ Issue 内の有限 retry は行います。quota に到達すると待機時刻を保存して終了し、次回の起動で復元します。reset 前の once は Codex を呼ばず終了します。

通常 mode はキューが空なら poll し、Issue があれば続けて処理します。常駐 worker の起動には、このドキュメントの作成だけでなく、ユーザーが実際に開始コマンドを実行する必要があります。

## 設定

設定は環境変数で渡します。秘密値は設定に含めません。

| 変数 | 初期値 | 意味 |
|---|---|---|
| `CODEX_WORKER_STATE_DIR` | `~/.local/state/care-record-codex-worker` | repository 外の state/worktree/log 保存先 |
| `CODEX_WORKER_REPO` | origin から取得 | 指定時は origin と一致する `owner/repo` |
| `CODEX_WORKER_POLL_SECONDS` | 60 | キュー空・実装 retry の待ち時間 |
| `CODEX_WORKER_MAX_RETRIES` | 1 | 初回失敗後の自動 retry 回数 |
| `CODEX_WORKER_QUOTA_BACKOFF_MINUTES` | 15 | reset 不明時の初期待機 |
| `CODEX_WORKER_WEEKLY_BACKOFF_MINUTES` | 720 | 週次上限で reset 不明時の初期待機 |
| `CODEX_WORKER_QUOTA_MAX_BACKOFF_MINUTES` | 1440 | 指数 backoff の最大待機 |
| `CODEX_WORKER_MAX_RUN_MINUTES` | 0 | 1回の Codex 実行の上限。0 は制限なし |
| `CODEX_WORKER_STOP_ON_FAILURE` | false | retry 上限後も worker 全体を停止するか |

reset / retry-after が得られればその時刻を優先し、未取得時だけ指数 backoff を使います。CLI の error event、stderr、構造化結果 `quota_wait` を判断に使います。reset 時刻は epoch seconds/milliseconds、ISO、Retry-After seconds/HTTP date、CLI のローカル時刻表記を扱います。quota は実装失敗の retry count に加算しません。週次上限でも長い backoff で同じ Issue の再利用を待ち、API 課金へ切り替えません。

## 実行と安全な停止

Issue ごとに `origin/main` を fetch し、専用 branch/worktree を作成して `npm ci` を行います。main や開発者の未コミット変更は実装用 worktree にコピーしません。Codex は `exec --json --output-schema`、`workspace-write`、`approval_policy=never`、ChatGPT 認証限定、sandbox の network access 無効で起動します。通常の shell に GitHub token、Supabase key、OpenAI API key 等を継承しません。Git metadata の読み取り専用保護を維持し、commit が sandbox で許可されない場合は検証後に親 worker が commit します。GitHub 操作と npm dependency 準備も親 worker が行います。

subprocess の環境は用途別の allowlist で分離します。

| 用途 | HOME / config / cache | 継承する認証 capability |
|---|---|---|
| npm ci / typecheck / lint / test / local Git | 実行ごとに新しい mode 0700 の一時 HOME。npm user/global config、XDG config/cache/data、Git global config も空の専用パスへ向け、終了後に削除 | なし。CODEX_HOME、GH token/config、SSH_AUTH_SOCK、API key、NPM_TOKEN を渡さない |
| Codex exec / resume / help | ChatGPT auth/session を発見する元の HOME / CODEX_HOME | Codex の HOME / CODEX_HOME のみ。GH token/config・SSH agent・API key は渡さない |
| gh / git fetch / git push | OS keyring の探索用に元の HOME を使用。cache/tmp は専用一時領域、gh config と Git global config は明示指定 | GH_CONFIG_DIR、GH_TOKEN / GITHUB_TOKEN、GH_HOST、SSH_AUTH_SOCK。Linux Secret Service 用 DBUS_SESSION_BUS_ADDRESS / XDG_RUNTIME_DIR。CODEX_HOME は渡さない |

`GH_CONFIG_DIR` が未指定なら、元の XDG_CONFIG_HOME または HOME から gh の config directory だけを解決します。GitHub 用の Git global config は `GIT_CONFIG_GLOBAL` または元の HOME の `.gitconfig` を使います。build の npm config/cache は毎回新しく作るため、以前の subprocess が書いた認証設定を再利用しません。repository の `.npmrc` に credential を置かないでください。この環境分離は同じ OS ユーザーのファイルアクセスまで隔離する sandbox ではありません。専用ユーザー・clone と Codex sandbox の運用前提は維持します。

ユーザー設定の MCP は利用できますが、外部認証・ネットワーク承認・専用試験環境が不足する Issue は `needs-human` に戻します。安全制約を緩めて続行しません。本番 migration、deploy、E2E は実装プロンプトで禁止しています。DB/RLS 変更は公開前検証でも人の確認を求めます。

Ctrl-C または worker PID への SIGTERM で停止します。実行中 Codex のプロセスグループへ SIGINT を送り、30秒待っても終了しなければ SIGKILL を送ります。worktree の未コミット差分、session ID、progress note を保持します。設定した最大実行時間への到達も同じ停止方法です。明示的な手動停止後は通常起動で同じ Issue から再開できます。Codex 自身が paused を返す場合・最大実行時間の場合は review 後に `--resume` を使います。

```sh
npm run codex:worker -- --resume
```

`--resume` は needs-human 等の手動停止を解除しますが、保存された quota の retry 時刻は飛ばしません。仕様・認証・専用環境の問題を解決してから使ってください。blocked / closed の Issue は再開しません。通常は保存された session を公式の `exec resume <session-id>` で再開します。resume command が JSON/schema に対応していない CLI では、同じ worktree の差分、commit、WORKER-PROGRESS.md、保存された残作業を使って新しい exec から再開します。session が手動削除されている場合は、その ID を state から除いたうえで `--resume` します。

失敗の retry 上限後は `codex:failed` とし worktree と state の Issue 別アーカイブを残します。再試行したい場合は原因を解決し、既存 worktree と branch を確認したうえで current state をそのアーカイブから復元するか、作業を人へ引き継ぎます。単に ready に戻すと既存 branch と衝突するため、自動で branch を削除・上書きしません。

## state とログ

state directory は mode 0700、JSON/log/lock は 0600 で作成します。`state.json` を原子的に更新し、worker status、Issue、branch、worktree、session、失敗回数、quota 待機時刻、終了理由、残作業を保持します。`runs/<issue>-<timestamp>/` に JSONL の安全な要約、stderr の内容を除去した要約、redaction 済み structured result を保存します。

JSONL は event type と quota 分類だけを保存し、コマンド、tool 出力、推論、Issue 本文、free-text error を保存しません。structured result の既知 token/secret は除去します。ただし任意の個人情報を文字列から完全に判別できる仕組みではないため、実行ユーザー・入力・参照可能なファイルを合成データに限定することが前提です。Codex 自身の session 保存先は Codex が管理し、worker が login/session files をコピーすることはありません。

kill -9 / 電源断では lock が残る場合があります。worker とその Codex 子プロセスがすべて停止したことを確認してから `worker.lock` だけを削除し再起動します。自動で stale lock を奪いません。state が壊れていたら停止します。worktree、Issue 別 JSON、run logs を使って復元し、state を消して別 Issue へ飛ばさないでください。

## Draft PR

completed かつ safe_to_open_pr の結果に限り、worker が変更領域を確認し、typecheck/lint と関連 unit/UI tests を再実行します。残っている実装差分は親 worker が commit し、commit と clean worktree を確認して push します。既存 migration の変更・秘密ファイル・未完了 progress note の追加は拒否します。PR は `Closes #<issue>`、概要、実行検証、未実行と理由、security/RLS/migration 影響を記載した Draft です。Issue は ready/running を外し、PR merge まで open のままにします。

公開途中の失敗は publish stage のまま needs-human に保存します。resume は同じ branch の Draft PR を確認して再利用するため、PR 作成成功後にラベル更新が失敗しても新しい PR を作りません。既存の non-draft / closed / merged PR は人へ戻します。自動 merge はありません。

## macOS / Linux の常駐

最初は foreground で dry-run → once を確認します。常駐時は executable の絶対パス、専用 clone の WorkingDirectory、state directory、認証用 HOME、Context7 の設定を明示します。休止中のマシンでは処理できないため、必要なら macOS の `caffeinate` や OS の電源管理を使います。

Linux は user systemd service を使います。以下のパスを自分の専用ユーザーに合わせて変更して、repository 外の `~/.config/systemd/user/care-record-worker.service` に保存します。

```ini
[Unit]
Description=CareRecord Codex Continuous Worker
StartLimitIntervalSec=3600
StartLimitBurst=3

[Service]
Type=simple
WorkingDirectory=/home/worker/care-record-worker
ExecStart=/usr/bin/node /home/worker/care-record-worker/scripts/codex/continuous-worker.mjs
Environment=HOME=/home/worker
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=CODEX_WORKER_STATE_DIR=/home/worker/.local/state/care-record-codex-worker
Restart=on-failure
RestartSec=60
TimeoutStopSec=45
KillMode=mixed

[Install]
WantedBy=default.target
```

`systemctl --user enable --now care-record-worker` で起動、`systemctl --user stop care-record-worker` で停止します。ログアウト後・再起動後も動かす場合は管理者に user lingering の設定を依頼します。needs-human による正常終了を service が再起動しないよう `Restart=always` は使いません。

macOS は `~/Library/LaunchAgents/local.care-record.codex-worker.plist` に次の構成を保存し、パスを変更します。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.care-record.codex-worker</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/node</string>
    <string>/Users/worker/care-record-worker/scripts/codex/continuous-worker.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/worker/care-record-worker</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key><string>/Users/worker</string>
    <key>CODEX_WORKER_STATE_DIR</key><string>/Users/worker/.local/state/care-record-codex-worker</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>ExitTimeOut</key><integer>45</integer>
</dict></plist>
```

`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.care-record.codex-worker.plist` で登録し、停止は `launchctl bootout gui/$(id -u)/local.care-record.codex-worker` です。LaunchAgent はユーザーのログイン後に動きます。ログイン前の無人起動を必要とする場合は、専用 Linux ホストの user service 等を使います。needs-human の解決後は foreground の `--resume` で確認し、再度 service を起動してください。

## 検証とドキュメント確認

```sh
npm run test:codex-worker
npm run typecheck
npm run lint -- --max-warnings=0
```

worker の自動テストは CLI/GitHub を mock し、キュー、依存、quota reset/backoff、再起動復元、同一 Issue の再開、dry-run/status の read-only、ログの秘匿、Draft PR を検証します。CI の lint-security job に組み込んでいます。実運用の ChatGPT 消費、push、PR 作成、daemon 登録はこのテストでは行いません。

2026-10-03 に Context7 `/openai/codex` と [公式の非対話実行](https://developers.openai.com/codex/noninteractive)、[configuration reference](https://developers.openai.com/codex/config-reference)、インストール済み `codex-cli 0.159.0-alpha.12.1` の help を確認しました。確認対象は JSONL / output schema / thread.started / exec resume / workspace-write / approval_policy / forced_login_method と quota error の resets_at 表記です。GitHub CLI は 2.96.0 の help を確認しています。CLI 更新後は exec/resume の help と worker tests を再確認してください。

PR #65 の credential 境界修正では、2026-10-03 に Context7 `/openai/codex` の HOME/CODEX_HOME による認証・session 発見と、`/npm/cli` の userconfig/globalconfig/cache override を再確認しました。npm 11.6.2 の実 lifecycle script と build subprocess を使う自動テストで、認証 capability の除外・一時 HOME の削除を確認します。

macOS の gh 2.96.0 は OS keyring の読み取りに `security` を使います。一時 HOME では keyring が見つからず、公開 repository の API が成功しても `gh auth status` と認証必須 `gh api user` は失敗しました。GitHub 操作だけログイン HOME を維持し、手動 token export／token のファイル化は不要です。Linux の Secret Service session capability も GitHub 操作だけに継承します。build と Codex の allowlist は変更しません。元の HOME を渡す GitHub 操作は信頼できる gh/git に限定してください。同一ユーザーでのファイルアクセス自体は sandbox 境界ではありません。確認: 2026-10-03、Context7 `/cli/cli` の keyring token 解決と gh 2.96.0 の公式実装。

## 既存 worktree の検査と sandbox テストの委譲

Codex 起動前と親の公開検証前に origin/main を fetch し、branch、HEAD、保存 base の祖先関係、origin/main、local commits、tracked/untracked changes を検査します。保存 base は remote の SHA だけでは更新しません。`prepare`、clean、session/progress/result/lastRun なし、local commits なし、HEAD が最新 main の祖先である場合だけ `merge --ff-only` で更新し、成功後に base を保存します。作業済みの stale worktree は `stale_existing_worktree`、保存 base が HEAD の祖先でない場合は `worktree_base_mismatch` として needs-human で停止します。state に SHA と dirty/local commit の診断情報を残し、reset/rebase/clean/stash は実行しません。resume でも session/base/failures は整合性検査が失敗した場合に保持します。

Codex が sandbox の listen EPERM／browser launch restriction で実行できなかったチェックは、親が必ず再実行する場合だけ `unrun_tests` にコマンドと制約を記載して completed に委譲できます。対象は shared UI 変更の Storybook UI と、package.json/package-lock.json 変更で定義された標準 test の unit/UI です。typecheck/lint、任意の検査、assertion failure、DB/RLS/migration、production、認証要求、外部サービス、破壊的操作、security/retention 判断は委譲できません。sandbox bypass は禁止です。

親は実際の scripts を読み、標準 `test` が `npm run test:unit && npm run test:ui`、leaf が `vitest run --project unit` / `vitest run --project storybook` で pre/post hook がないことを検査します。異なる定義は人へ戻し、E2E/DB/外部処理を起動しません。親のテストは credential-free HOME/cache と固定の test/loopback dummy Supabase 値で実行します。Chromium のインストール済み cache は明示的な PLAYWRIGHT_BROWSERS_PATH（未指定なら OS 標準 cache path）で探索し、ブラウザを自動インストールしません。不足時も公開せず人へ戻します。実サービスの認証値は渡しません。全チェック成功後だけ commit/push/Draft PR に進み、親が実行したコマンドを PR の検証記録に追加します。

既存の作業済み stale worktree は人間が安全な4段階で復旧します。まず worker/子プロセス停止と branch/status/history を確認し、レビューした非機密ファイルだけ repo 外へバックアップします。次にそのファイルを明示指定したローカル checkpoint commit に保存します（push せず、E2E禁止時は `[skip ci]` を付ける）。最新 main を fetch し、reset/rebase ではなく通常の merge で取り込み、競合をレビューして解決します。最後に HEAD に最新 main が含まれることを merge-base で確認してから、排他停止中に保存 base をその main SHA と一致させます。session・stage・worktree は保持し、結果/差分の再レビュー後に once/resume します。状態更新は Git の実状態の確認後にのみ行い、単に base の値だけを書き換えないでください。

確認: 2026-10-03、Context7 `/websites/git-scm_doc` の merge-base／fast-forward merge 仕様。実 Git 回帰テストと標準 npm test の実 subprocess で履歴・差分保全と親の成功/失敗の公開ゲートを検証します。
