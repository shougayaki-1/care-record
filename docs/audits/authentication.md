# 認証・重要操作再認証・Google Calendar 監査（Phase 0）

対象: main `3cbae8813a872a100f6d980bab631b9ef5ea6a7c`。確認日: 2026-09-02。コードの読取調査のみ。実装・設定・migrationの変更、DB接続、本番操作、E2E、OAuth実接続、テスト実行は行っていない。以下の `Confirmed` はコード上の分岐・契約を確認した意味であり、本番での脆弱性成立や稼働設定を確認した意味ではない。

優先事項は、シフト更新のPermission/RLS/成功判定不整合、セッション寿命を再初期化する経路、再認証を強制しない公開RPCである。一括削除中のGoogle認証エラー後の未処理行とowner移管監査も追跡する。P0を裏付ける証拠はない。Google同期の性能は別監査に委ね、ここでは認証・失敗・復旧時の整合性を扱う。

## 調査基準と外部仕様

`CLAUDE.md`、`.claude/rules/{frontend,security,supabase,testing}.md`、`docs/{architecture,system-decisions,security-and-permissions}.md`、`docs/compliance/README.md` を読んだ。元checkoutの未追跡 `AGENTS.md` は作業ガイドとしてのみ扱い、snapshotのソースには含めていない。PR #11および `ai_context_output` は実装の正本として使用していない。

ロック済み依存は `package-lock.json:4305` のauth-js 2.108.2、`:4360` のSSR 0.8.0、`:4385` のsupabase-js 2.108.2、`:8652` のgoogleapis 171.4.0。Context7で2026-09-02に次を照会した。最新版文書だけで本番動作を断定せず、実環境の確認は後述のマトリクスに残す。

- `/supabase/supabase`: JavaScript `signOut()` の既定scopeはglobal、localは当該sessionのみ、失効済みaccess tokenの有効期限までは別途考慮が必要。[公式sign-outガイド](https://github.com/supabase/supabase/blob/master/apps/docs/content/guides/auth/signout.mdx)
- `/websites/developers_google_identity`: `prompt=consent` は同意画面、`select_account` はアカウント選択の指定。新しい資格情報入力の証明とは同一視しない。[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)

## 実装経路と確認できた防御

| 機能 | UI → Action / Route → API / DB | コード上の防御・限界 |
|---|---|---|
| パスワードログイン | `src/components/auth/AuthForm.tsx:114` → `src/app/actions/auth.ts:103` `loginWithPassword` → Auth `signInWithPassword` → `src/utils/supabase/auth.ts:86` `registerSessionActivity` → `user_session_activity` | IP・emailハッシュに対する15分5失敗と段階遅延は `src/utils/supabase/loginAttempts.ts:31`・`:55`。Auth成功後にのみ活動登録。失敗理由の一部は区別される。Supabaseの公開Auth APIを経た直接ログインの抑制は別途設定確認が必要。 |
| Google / Azureログイン | `src/components/auth/AuthForm.tsx:62` `handleOAuth` → browser `signInWithOAuth(provider)` → `src/app/auth/callback/route.ts:53` `exchangeCodeForSession` → 活動登録・監査 | 通常ログインcallbackは再認証grantを発行しない。成功Responseにcookieを集約し、no-storeを付ける（`:24`・`:65`・`:82`）。AzureにもGoogle用のoffline/consent queryが渡るため、provider設定・戻りURL・scopeの実動確認を残す。 |
| SSR / client refresh | `src/lib/supabase.ts:12` browser client → `src/context/WorkspaceContext.tsx:190` Authイベント → `ensureSessionActivity`。SSRは `src/proxy.ts:30` → `src/utils/supabase/middleware.ts:38` `updateSession` | ProxyはAuth `getUser`（`:84`）後、DBでuser/session/revoked/idle/absoluteを照合（`:137`）。cookie更新・redirectへのcookie引継ぎあり（`:62`・`:86`）。`/api` とprefetchはmatcher対象外（`src/proxy.ts:36`）で個々のRoute/RPC認可に依存。 |
| 無操作24h・絶対30d | `src/utils/authConstants.ts:4`、`src/components/auth/IdleTimeout.tsx:53` → `heartbeatSession` → `touchCurrentSession`。Actionは `getAuthedUser`、DBは `private.is_session_active` | Actionの照合は `src/utils/supabase/auth.ts:141`。RLSの照合は `supabase/migrations/20260630235959_init.sql:436`。数値は整合。ただし更新経路が制約を維持しない（AUTH-01）。 |
| ログアウト | `src/utils/clientLogout.ts:15` → `recordLogout` → `revokeCurrentSession` → browser `signOut({scope:'global'})` | 現在sessionのDB失効とAuth global失効を意図する。監査例外時のDB失効スキップはAUTH-10。global logoutでもDBの活動行の一括失効は実装されていない。 |
| password再認証 | settings `src/app/app/settings/page.tsx:227` / `:488` → `issueReauthGrant` → 一時Auth client → `reauth_grants` | 現在本人のpasswordを検証し元sessionに束縛。ランダム32byte、DBはSHA-256 hash、10分有効。`consumeReauthGrant` はuser・session・purpose・未使用・期限を条件にUPDATE（`src/utils/supabase/reauth.ts:68`）。`signOut`副作用はAUTH-03。 |
| SSO再認証 | settings `:237` → `beginStepUpReauth` → Auth OAuth → `src/app/auth/reauth-callback/route.ts:71` → `completeStepUpReauth` → grant cookie → settings `:196` | password有無はRPCで判定（`src/utils/supabase/stepupReauth.ts:33`）、Google/Azureのみ。nonceのcookie照合、hash・期限・一度限り消費、開始時本人一致（`:68`・`:81`）。grant cookieはHttpOnly、60秒、読出し後削除（`src/app/actions/auth.ts:57`）。認証鮮度はAUTH-08。 |
| 破壊的操作 | settings `:214` / `:491` → `deleteOrganization` → `soft_delete_organization`。`transferOwner` → `transfer_owner_atomic` | Actionでpurposeを分離（`src/app/actions/organization.ts:82`・`:105`）。RPCはactive sessionとowner/管理権限を確認するが、再認証grantを確認しない（AUTH-02）。オーナー移管Actionへの現在のUI呼出しは検索で見つからず、利用可能なActionとUI到達性を分けて扱う。 |
| Calendar接続開始 | settings `:341` → `getGoogleAuthUrlAction` → `storeOAuthNonce` → Google authorization | integrations権限。password/別SSOはexternal_secret_change grant、Google SSOのみなら同一Google subject検証をサーバーnonce行に記録（`src/app/actions/google.ts:57`）。stateはランダムnonce、orgはHttpOnly cookie、DBはuser/org/provider/10分/未使用条件（`src/utils/supabase/oauthNonce.ts:38`）。 |
| Calendar callback | `src/app/api/google/callback/route.ts:30` → Auth `getUser` → `get_google_oauth_context` → nonce消費 → `getToken` → `complete_google_oauth_connection` | 同一Google subjectとaudience検証はGoogle SSO統合経路のみ（`:90`）。offline/consentを要求しrefresh token必須。既存calendar IDは保持、新規ID作成は未連携時だけ（`:115`）。nonce・権限不一致では書込前に拒否。 |
| token暗号化・更新 | callback `:146` → `encryptGoogleToken` → `organizations.google_refresh_token`。同期/healthは `decryptGoogleToken` → OAuth client `setCredentials` | `src/utils/googleTokenCrypto.ts:27` はAES-256-GCM、12byteランダムIV、auth tag、key ID。v1 legacy復号を維持、productionの平文拒否（`:36`）。平文refresh tokenやaccess tokenをUIへ返すコードはこの経路で見つからない。実際のkeyring、provider refresh動作、rotationは未確認。 |
| 同期途中失敗と復旧 | settings `:437` → `syncUnsyncedBatch` → `processShiftsSequential` → `syncToGoogleCalendarDirect` → Google API → `mark_shift_google_sync` | authは即停止、rate_limit/transientのみbackoff（`src/app/actions/shifts/googleSyncInternal.ts:36`）。upsert失敗をfailedとして再実行対象に残す（`:311`）。再認証後の未同期再実行・修復は手動。delete途中停止はAUTH-04、案内はAUTH-05。 |

`reauth_grants` と `stepup_reauth_challenges` はRLS有効かつanon/authenticatedへの直接table権限を剥奪（`supabase/migrations/20260716000007_release_readiness_foundation.sql:19`、`20260721000001_stepup_reauth_challenges.sql:23`）。これ自体は肯定的な防御だが、重要操作RPCでの再認証強制を代替しない。

## 所見

### AUTH-01 — ensureSessionActivityが既存sessionの絶対期限をrolling再発行する

- Category: セッション寿命・失効
- Severity: P1
- Confidence: Confirmed（絶対期限の上書き）。`revoked_at` による失効session復活はNeeds runtime verification。
- Summary: 主因は `src/app/actions/auth.ts` の `ensureSessionActivity`。既存sessionにも `last_activity`、`absolute_expires_at`、`revoked_at` をupsertし、特に `absolute_expires_at=now+30日` を毎回再設定するため絶対期限がrollingになる。`TOKEN_REFRESHED` でも呼ばれるため、人の無操作とは別に期限が延長される。
- Evidence: `src/app/actions/auth.ts:169` `ensureSessionActivity`、`:183`・`:184`・`:190`。呼出しは `src/context/WorkspaceContext.tsx:72` `fetchWorkspaces` と `:192` のINITIAL_SESSION/SIGNED_IN/TOKEN_REFRESHED。`touchCurrentSession` と middleware bootstrap（`src/utils/supabase/auth.ts:116`、`src/utils/supabase/middleware.ts`）には既存の期限・失効防御があり、このFindingのroot causeには含めない。
- Relevant files: 上記4ファイル、`src/utils/supabase/middleware.ts`、`src/components/auth/IdleTimeout.tsx`。
- Impact: 30日の「絶対」期限と24h idleのサーバー側保証がこの更新経路で弱まる。`revoked_at:null` による失効session復活の可能性はあるが、global signOut後のaccess tokenで `supabaseAdmin.auth.getUser()` が成功するかを含めruntime確認が必要。
- Next investigation: 隔離環境で同一sessionのTOKEN_REFRESHED前後にcreated_at/absolute/revoked/last_activityを比較し、失効行ではglobal signOut後のaccess tokenを `supabaseAdmin.auth.getUser()` へ渡すケースを別に確認する。

### AUTH-02 — 重要操作RPCがActionのstep-up再認証を要求しない

- Category: step-upとDB認可境界
- Severity: P1
- Confidence: Confirmed（現行SQLの公開権限と検証欠落）。本番適用状態は未確認。
- Summary: owner移管・組織削除・`update_organization_setting('calendar_disconnect')` のActionはgrantを消費するが、authenticated公開RPC側はactive session、owner、management permission、tenant boundaryを検査するだけでstep-upを検証しない。RPCが無防備なのではなく、reauthenticationだけを直接RPCで迂回できる。
- Evidence: `src/app/actions/organization.ts:54`・`:82`・`:105` と、`supabase/migrations/20260716000015_org_deletion_rls.sql:60` `update_organization_setting` / `:83` `soft_delete_organization` / `:116` `transfer_owner_atomic` / `:132` `GRANT EXECUTE TO authenticated`。RPCの引数・本体にgrant消費がない。
- Relevant files: 上記3ファイル、`src/utils/supabase/reauth.ts`、`src/app/actions/google.ts`。
- Impact: activeなJWTを持つ認可済み主体について、アプリが重要操作時に求める再認証をDB境界で強制できない。一般メンバーがownerへ昇格できるという所見ではない。既存のactive session、owner、management permission、tenant boundaryは維持されている。
- Next investigation: ローカルDBで認可済みownerと非owner、未発行・期限切れ・使用済みgrantを組み合わせてRPC契約を確認。重要操作とgrant消費を同じDBトランザクションに束縛する設計を検討する。

### AUTH-03 — password再認証の後始末が全sessionを失効させる呼出しになっている

- Category: password再認証・session継続
- Severity: P2
- Confidence: Strong indication
- Summary: Cookieを変更しない一時verifierでpassword検証した直後、scopeなしの `signOut()` を呼ぶ。公式JavaScript仕様ではglobalが既定であるため、元の利用sessionと他端末のrefresh tokenも失効する可能性が高い。
- Evidence: `src/utils/supabase/reauth.ts:55` `issueReauthGrant` の一時client作成、`:61` login、`:63` signOut、`:65` 元session IDにgrant発行。依存固定は `package-lock.json:4305`・`:4385`。上記Context7の公式sign-out仕様。
- Relevant files: `src/utils/supabase/reauth.ts`、`src/app/app/settings/page.tsx`、`package-lock.json`。
- Impact: Calendar再接続や組織削除前の再認証を通過しても、元sessionの次回refresh時にログインへ戻り、操作継続や別端末の利用を妨げ得る。これを「再認証が安全に完了した」と扱うには実測が必要。
- Next investigation: 二つの独立sessionと一時verifierを用い、再認証前後の元session refresh可否を確認する。成功したgrant発行とsession延命を別の検証項目にする。

### AUTH-04 — 一括削除中のauth失敗で、未処理シフトまで論理削除候補になる

- Category: Calendar認証中断・削除整合性
- Severity: P2
- Confidence: Confirmed（制御フロー）。Google/DBを使う再現は未実施。
- Summary: バッチ処理はauth失敗した1件だけをfailedIdsへ追加してbreakするが、呼出し元は「全対象−failedIds」を削除成功扱いする。後続の未処理IDが含まれる。
- Evidence: UI `src/app/app/shifts/manage/page.tsx:347` は20件chunk、`:353` `deleteShiftsBatch`。`src/app/actions/shifts/googleSyncInternal.ts:300` `processShiftsSequential` → `:313` failedIds → `:315` auth break。`src/app/actions/shifts/crud.ts:246`・`:247` `deletableIds` → `:250` `softDeleteShiftIds`。`src/app/actions/shifts/internal.ts:54` は `soft_delete_shifts_atomic` に `p_sync_status:'synced'` を渡す。
- Relevant files: 上記4ファイル、`supabase/migrations/20260716000013_shift_generation_rls.sql:3`。
- Impact: UIは20件chunkで処理するため、auth失敗が発生したchunk内の後続最大19件がGoogle未処理のままCareRecord側の削除候補になり得る。問題はConfirmedだがsilent failureではない。`repairGoogleCalendarSync` によるrecovery pathは存在するものの手動復旧が必要で、Google側にeventが残存する期間が発生する。
- Next investigation: 外部APIを差し替えた隔離テストでchunk内途中auth失敗を与え、成功・失敗・未処理IDを照合。repair経路での手動復旧手順と残存期間を記録する。

### AUDIT-01 — owner移管操作に監査イベントがない

- Category: 重要操作監査
- Severity: P2
- Confidence: Confirmed（Action/RPCの実装読取）
- Summary: `transferOwner` 成功時に対応するaudit eventがServer Actionにも `transfer_owner_atomic` RPCにも存在しない。
- Evidence: `src/app/actions/organization.ts:101`〜`:120` はgrant消費後にRPCを呼ぶが監査記録を行わない。`supabase/migrations/20260716000015_org_deletion_rls.sql:116`〜`:128` のRPCにもaudit insertがない。`.claude/rules/security.md` および `docs/system-decisions.md` の重要操作監査要件と不整合。
- Impact: owner変更の実行者、対象組織、結果を `audit_events` から追跡できず、事後調査・説明責任・不正検知の証跡が欠ける。AUTH-02の再認証迂回とは別のFindingである。
- Severity rationale: owner移管は重要操作だが、現行コードにはactive session、owner、management permission、tenant boundary、step-up grantのAction側検査がある。直接の認可回避ではなく、監査要件と追跡可能性の欠落としてP2とする。
- Relevant files: `src/app/actions/organization.ts`、`supabase/migrations/20260716000015_org_deletion_rls.sql`、`src/utils/supabase/audit.ts`、`.claude/rules/security.md`。
- Next investigation: 成功・拒否・RPC例外の各結果で、actor/org/target/resultが一貫してaudit_eventsへ記録される契約を確認する。

### AUTH-05 — 認証切れの復旧案内が既存カレンダー保持経路と矛盾する

- Category: Calendar復旧UX・ID維持
- Severity: P2
- Confidence: Confirmed
- Summary: 「Googleを再認証」ボタンと既存ID維持callbackがある一方、同期/修復のauthエラーは「連携を解除後に再接続」を案内する。案内どおり解除すると組織のcalendar IDとtokenが消え、再接続時に新規calendarを作る。
- Evidence: `src/app/app/settings/page.tsx:414` `reportSyncResult`・`:424` `reportRepairResult` の文言、`:729` のreauthorizeボタン。`src/app/actions/organization.ts:54` `disconnectGoogleCalendar` → `supabase/migrations/20260716000015_org_deletion_rls.sql:76` のID/token消去。`src/app/api/google/callback/route.ts:119` は既存IDなしの場合 `:132` で新規作成。`src/app/actions/shifts/googleSync.ts:46`・`:59` はID/tokenの存在とshiftのevent ID/statusで同期判定し、calendar世代は照合しない。
- Relevant files: 上記5ファイル。
- Impact: 古いGoogleカレンダーと予定を残して新規カレンダーへ切り替わり、既存shiftは以前のevent IDを持ったまま「未同期0件」となる可能性がある。通常の再認証だけなら既存IDを保持する実装は肯定できる。
- Next investigation: 同期済みshiftを含む組織で、(a)再認証、(b)解除→接続を分け、calendar ID/event ID/未同期件数を比較。案内を既存ID保持の復旧導線に統一する判断を行う。

### AUTH-06 — Calendar状態の分類が403権限不足・一時障害・設定不備を区別しきれない

- Category: Calendar health・復旧判断
- Severity: P2
- Confidence: Confirmed
- Summary: healthはquota以外の403をreauth_requiredへまとめ、宣言済みforbiddenを返さない。callbackの既存calendar確認は全例外をcalendar_missingへまとめる。HTTP codeなしの鍵/環境設定エラーも共通分類でtransientとなる。
- Evidence: `src/utils/googleSync.ts:52` `classifyGoogleError`（invalid_grant/token）、`:60` 401、`:61` 403、`:70` 429、`:71` 5xx、`:72` codeなし。`src/app/actions/google.ts:35` `getGoogleConnectionHealth`、`src/app/api/google/callback/route.ts:121` 既存calendar確認と`:129`。`src/utils/googleTokenCrypto.ts:23`・`:49` の設定エラー。状態保存は `supabase/migrations/20260716000016_google_sync_rls.sql:42` `update_google_connection_health`。
- Relevant files: 上記5ファイル、`src/app/app/settings/page.tsx:119`。
- Impact: 権限不足に何度も再認証、429/5xxにカレンダー欠落案内、鍵設定不備に待機再試行という誤った復旧判断を誘発する。エラー種別の存在自体は確認でき、invalid_grant/401とrate/transientの基本分類はある。
- Next investigation: refresh invalid_grant、401、403 permission、403 quota、404、429、503、通信断、復号鍵欠落を同一マトリクスで注入し、返却状態・永続状態・画面案内を照合する。

### AUTH-07 — 修復開始前のAPI失敗が成功トーストへ流れる

- Category: Calendar復旧結果表示
- Severity: P2
- Confidence: Confirmed
- Summary: `repairGoogleCalendarSync` の最初のイベント列挙が失敗すると `failed:0` と非authのerrorKindを返し、UIはfailedが0のため修復完了と表示する。
- Evidence: `src/app/actions/shifts/googleSync.ts:197`〜`:212` `repairGoogleCalendarSync` のcatch。`src/app/app/settings/page.tsx:424` `reportRepairResult` はconnected/auth/failedだけを分岐し、`:432` で成功表示する。
- Relevant files: `src/app/actions/shifts/googleSync.ts`、`src/app/app/settings/page.tsx`、`src/utils/googleSync.ts`。
- Impact: 429、5xx、ネットワーク断、404等で1件も処理していないのに修復完了と認識される。復旧後の再実行が見送られ、未同期/削除残りを見逃す。
- Next investigation: 初回events.list失敗を注入し、実行不能・部分完了・全完了を区別する結果契約とUI表示を確認する。

### AUTH-08 — SSO step-upで新しい本人認証の鮮度を検証していない

- Category: 重要操作のSSO再認証
- Severity: P2
- Confidence: Strong indication
- Summary: 別callback・nonce・同一本人照合はあるが、通常のOAuthコード交換が成功したことを再認証証明にしている。画面の `prompt=select_account` やCalendarの `prompt=consent` だけでは、既存IdPログインsessionからの新しい資格情報入力を保証できない。
- Evidence: `src/app/app/settings/page.tsx:237` `startOAuthStepUp` と `:244` のqueryParams。`src/app/auth/reauth-callback/route.ts:79`〜`:80`、`src/utils/supabase/stepupReauth.ts:59` `completeStepUpReauth` はuser一致・nonce期限等を検証するが、provider/auth_time等は検証しない。Calendar統合経路は `src/app/actions/google.ts:101` と `src/app/api/google/callback/route.ts:90` のsubject照合。Context7のGoogle prompt仕様も参照。
- Relevant files: 上記5ファイル。
- Impact: Google/Azureへ既にログイン済みの共用端末で、追加の秘密情報入力なしに重要操作grantが発行され得る。nonceはCSRF・再利用防止には効くが、認証鮮度の証明とは別。実際のIdPポリシーに依存し、認証回避の成立を断定しない。
- Next investigation: Google/Azure既存IdP sessionあり/なしで、表示画面と新規credential入力を記録。承認済み「重要操作再認証」の要件を定義し、IdPが提供する検証可能な鮮度情報との対応を確認する。

### AUTH-09 — passwordログイン後のnext遷移が同一originに制限されていない

- Category: ログイン後リダイレクト
- Severity: P2
- Confidence: Confirmed
- Summary: queryのnextをそのまま `window.location.href` に代入する。通常OAuth callbackは同一originの絶対pathに絞るが、passwordログイン/即時登録経路に同じ制約がない。
- Evidence: `src/components/auth/AuthForm.tsx:25` `nextUrl`、`:107` 登録後、`:122` ログイン後。対照は `src/app/auth/callback/route.ts:12` のpath検査。
- Relevant files: `src/components/auth/AuthForm.tsx`、`src/app/auth/callback/route.ts`。
- Impact: 攻撃者が指定した外部URLへログイン直後に誘導できる構造。OAuth tokenが外部へ渡るという証拠はなく、ここでは外部遷移・フィッシング導線に限定する。
- Next investigation: 隔離ブラウザで外部origin・scheme-relative・通常アプリpathのnextを確認し、ログイン方式を通じた遷移先検証の統一を検討する。

### AUTH-10 — logout監査の失敗が現在sessionのDB失効も止める

- Category: logout失効・障害時制御
- Severity: P2
- Confidence: Confirmed（処理順序）。残存access tokenの利用可否はNeeds runtime verification。
- Summary: `recordLogout` の同じtry内で監査をawaitした後にDB失効するため、監査保存がthrowすると失効を実行せずcatchへ進む。さらに `revokeCurrentSession` はDB updateのerrorを確認しない。
- Evidence: `src/app/actions/auth.ts:143` `recordLogout`、`:146` 監査、`:154` 失効、`:155` catch。`src/utils/supabase/auth.ts:132` `revokeCurrentSession`。clientは `src/utils/clientLogout.ts:22` でその後global signOutするが、DBの活動行までは失効しない。RLSの活動判定は `supabase/migrations/20260630235959_init.sql:436`。
- Relevant files: 上記4ファイル。
- Impact: 監査障害や失効更新失敗時にアプリ独自の即時失効を保証できない。Auth側refresh失効は別途行われるため、全ログアウト失敗とは断定しない。access token期限までのDB直接アクセスについて要確認。
- Next investigation: audit保存例外/失効DB例外/正常の3条件で旧tokenによるAction・直接DBアクセスとrefresh結果を確認する。

## 仕様・文書との差分（脆弱性と同一視しない）

- `docs/system-decisions.md:65` はGoogle追加/解除に再認証不要とするが、現コードは `external_secret_change` grantまたはGoogle本人一致を要求する。再認証を削除・追加する判断は行っていない。
- `docs/architecture.md` のGoogle同期説明は `src/app/actions/shift.ts` を主実装とし「google_event_id IS NULL」を真実の源と書くが、現実装は `src/app/actions/shifts/*` に分割され、pending_upsert/failedも未同期判定に使う。
- MFA未対応および24h/30dという長さ自体は承認済みaccepted-riskであり、新しい所見に数えない。AUTH-01はその採用値が更新経路で維持されない点を対象とする。
- `backup_restore` はDB grant purposeの列挙にはあるが、TypeScript `REAUTH_PURPOSES` は3種類で復元を含めない（`src/utils/supabase/reauth.ts:12`）。このレポートでは復元機能の存在・不在を断定しない。

## 未実施の動作確認マトリクス

全項目が **Needs runtime verification**。以下は次段階の計画であり、実行済み結果ではない。合成データ、隔離Auth/DB、API差し替えを優先し、実OAuthの確認は専用環境で行う。

| ケース | 確認する結果・観測点 |
|---|---|
| password正常/不正/未確認email/並列失敗 | cookie確立、活動行、監査、IP+email制限。直接Auth endpointとの差も確認。 |
| Google/Azure通常login、取消、code再利用、PKCE失敗 | providerごとのscope/redirect許可、成功cookie、失敗後に再試行可能。 |
| SSR/server action/client refreshの同時発生 | Proxyで更新したrequest cookieが後続SSRへ届くか、Response cookieが複数回setでも欠けないか、401が一時障害扱いと混ざらないか。 |
| idle 24h直前/経過後、absolute 30d直前/経過後 | UI timer・Proxy・Action・RLSで同じ境界。refreshだけでidle/absoluteが延びないこと（AUTH-01）。 |
| session活動行なし/失効済み/DB一時障害 | fresh-JWT bootstrapは既存失効行を復活させない。ensure/upsertとの違いを記録。 |
| logout正常/監査失敗/DB失効失敗/二端末 | 現sessionと他端末の旧access token・refresh token、DB活動行を別々に検証（AUTH-10）。 |
| password/メール変更後の他端末 | `src/app/app/profile/page.tsx:93`・`:109` の直接Auth update後、provider失効とアプリ活動行が整合するか。UIからの追加再認証、旧/新email確認設定も検証。 |
| password step-up正常/誤password/期限切れ/二重消費 | user/session/purpose束縛、同時consumeの一度限り、元session refresh維持（AUTH-03）。 |
| SSO step-up Google/Azure/password追加済み/別account | current_user_has_password、nonce cookie、期限、本人一致、credential入力鮮度（AUTH-08）、失敗時cookie復元。 |
| 二組織・別tabでstep-up中にworkspace変更 | 戻り先currentOrgと開始時の操作対象が一致するか。grantがpurpose/user/sessionのみを持つこととUI確認対象の関係。 |
| owner移管/組織削除をRPC直接実行 | 通常権限ありでも未再認証を拒否できるか、非ownerは拒否するか（AUTH-02）。 |
| owner移管の成功/拒否/例外 | actor・org・旧/新owner・結果がaudit_eventsへ記録されるか（AUDIT-01）。 |
| Calendar開始/取消/state不一致/期限切れ/再利用/別組織 | token交換や保存へ進まないこと。早期return時のstate cookie掃除と再試行。 |
| Calendar code交換時のCareRecord session期限切れ | `/api` はProxy対象外かつcallbackの `setAll` はno-op（`src/app/api/google/callback/route.ts:55`）。refreshしたcookieが失われないか。 |
| refresh token未返却、Google同意scope不足、別Google account | tokenなしで既存設定を壊さないこと、SSO本人一致拒否、password利用者の他Google account接続時の既存calendarアクセス。 |
| token keyring現行/旧鍵/未知key ID/破損 | 暗号化・復号互換、GCM改ざん拒否、失敗の設定不備分類（AUTH-06）。 |
| invalid_grant/invalid_token/401/403 permission | reauth_requiredとforbiddenを区別し、権限回復または同一calendar再認証で正常復旧（AUTH-06）。 |
| 403 quota/429/5xx/通信断/404 | bounded retry、temporarily_unavailableとcalendar_missingの区別、修復成功誤表示をしない（AUTH-06/07）。 |
| Calendar同期1件目/途中のauth切れ | upsertは未同期/failedのまま再開できること。一括deleteは未処理行を論理削除しないこと（AUTH-04）。 |
| 同一calendar再認証後に再実行 | calendar ID維持、成功済みeventの重複なし、failed/pendingの再同期、deleted行の修復回収、healthのhealthy更新。 |
| 解除→再接続、calendar削除/権限剥奪後の回復 | 意図しない新規calendar作成や旧event IDの正常扱いを避ける（AUTH-05）。 |

既存 `src/utils/sessionActivity.test.ts`、`src/utils/supabase/stepupReauth.test.ts`、`src/utils/googleSync.test.ts` は分類・retry・nonce/本人判定等の単体試験ソースとして読んだが、本監査では実行していない。これらだけではAuth provider、Cookie伝播、RPCでの再認証強制、一括削除中断の統合動作を確認できない。
