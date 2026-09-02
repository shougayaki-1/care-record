# CareRecord Phase 0 — コードベース Audit

調査日: **2026-09-02 JST**。調査専用。アプリケーションコード、DB/schema/migration、CI、package、設定は変更していない。

## 対象と再現性

調査対象はGitHubで確認した `main` **`3cbae8813a872a100f6d980bab631b9ef5ea6a7c`**。[対象コミット](https://github.com/shougayaki-1/care-record/commit/3cbae8813a872a100f6d980bab631b9ef5ea6a7c)のファイルを正とする。別コミットで読む場合、証拠の行番号・結論は再照合が必要。

開始時の既存checkoutは `/Users/shoug/Documents/GitHub/care-record`。

```text
branch: main
git status --short --branch:
## main...origin/main [behind 68]
?? AGENTS.md

git log -5 --oneline:
d825065 refactor: update main page layout and structure for improved readability
c5b7e28 refactor: relocate historical migrations to an archive directory and implement new permission alignment schema
54882a0 fix: add missing GRANT EXECUTE for get_member_record_action_scope to authenticated
a54d73f fix: replace is_org_admin in report RLS policies with flexible role scope checks
dcb7b11 fix: resolve 8 db schema bugs found in production DB analysis
```

`git ls-remote origin refs/heads/main` により `origin/main` とGitHubの先端が同一SHAであることを確認した。ローカルbranchは切り替えず、`git archive <SHA>` の調査用コピーを使用した。未追跡の `AGENTS.md` は読み取りのみで維持し、対象SHAに含まれるファイルとは区別する。mainにはAGENTS.mdが存在しない。過去会話のAGENTS追加コミットやPR #11を現在の実装の証拠にしていない。

対象mainの直近5件:

```text
3cbae88 fix: make shift segment saves reliable
3f30223 Merge pull request #12 from shougayaki-1/fix/cloud-logging-tenant-scope
191b357 fix: scope Cloud Logging queries to caller's organization
2d1fa47 fix: repair shift title migration query
b1cd3cd fix: assign unique shift title migration version
```

## 調査範囲と読み方

- 指定18領域＋履歴・操作マニュアルの**20機能**。画面→Component/hook→Action/API→RPC/table、権限、監査、関連テスト、ライフサイクルを整理した。
- 認証、再認証、Google Calendarはcallback・nonce・cookie・grant・失効・中断後復旧まで追跡。RLS/RPCは現行migrationの定義・後続再定義・GRANTを確認した。DB実適用やリモートAuth設定は未確認。
- UI/Backend間の未接続、エラー/成功表示、検証値の差、設定構造を検索。利用実績を参照していないので、未接続は未使用の断定やREMOVE判断を意味しない。
- 性能は静的計測候補のみ。対象索引はsource **253ファイル**、現行migration **29ファイル**、source内test **35ファイル**、DB test **2ファイル**、`tests/` **9ファイル**。この件数はファイル数であり、全行精読・全経路の形式証明・テスト成功件数ではない。

|文書|内容|
|---|---|
|[feature-inventory.md](feature-inventory.md)|20機能の経路とライフサイクル|
|[authentication.md](authentication.md)|認証・再認証・Calendar、AUTH finding|
|[feature-gaps.md](feature-gaps.md)|UI↔実処理・保存・検証、GAP finding|
|[settings-ui.md](settings-ui.md)|設定台帳・権限・情報設計、UI finding|
|[performance.md](performance.md)|8件のMeasurement candidate、Optimistic UIとSkeleton/Suspense|
|[self-review.md](self-review.md)|別観点での自己レビュー、検証結果と限界|

Severity: **P0 Critical / P1 High / P2 Medium / P3 Low**。P1は危険操作の再認証境界、セッション失効、シフト整合性への影響を理由に限定。一般的なUI改善や未接続機能にP1は付けない。

Confidence: **Confirmed**は示したコード上の事実を確認、**Strong indication**は静的根拠があるが依存挙動/実行条件の追加確認が必要、**Needs runtime verification**は実測・設定・統合検証が必要。Confirmedでも本番発生や脆弱性悪用を確認した意味ではない。性能findingのConfidenceはすべてNeeds runtime verification。

## 集計と優先事項

機能ライフサイクルの補助項目、文書差分、未採番の調査候補はfinding数に含めない。

20機能の主分類は **ACTIVE 12 / POSSIBLY_INCOMPLETE 8**。POSSIBLY_UNUSED / INTENTIONALLY_FUTURE / UNCLEARは機能内の個別経路・運用状態へ付けている。ACTIVEは到達経路があることを示し、同機能にfindingがないという意味ではない。

**20機能、33 finding。P0: 0 / P1: 3 / P2: 26 / P3: 4。** このうち8件は性能のMeasurement candidate。脆弱性33件や本番障害33件を意味しない。

|台帳|件数|P0|P1|P2|P3|
|---|---:|---:|---:|---:|---:|
|Authentication|11|0|2|9|0|
|Feature gaps|8|0|1|6|1|
|Settings/UI|6|0|0|4|2|
|Performance|8|0|0|7|1|
|合計|33|0|3|26|4|

### 優先確認したい上位10件

|順|ID|Severity|コード上の問題・候補|優先理由|
|---:|---|---|---|---|
|1|GAP-01|P1|シフト更新のPermission/RLS/成功判定が不一致|DB実態・UI成功表示・監査の不一致|
|2|AUTH-01|P1|ensureSessionActivityが絶対期限をrolling再発行|採用済みのセッション期限保証に影響|
|3|AUTH-02|P1|3つの重要操作RPCでstep-up再認証を直接迂回可能|重要操作の防御をActionだけに依存|
|4|AUTH-04|P2|Google一括削除でauth失敗後の未処理IDも論理削除候補になる|chunk内最大19件、手動復旧が必要|
|5|AUDIT-01|P2|owner移管成功時の監査イベントがない|重要操作の追跡証跡が欠落|
|6|AUTH-05|P2|再認証案内の「解除→接続」がcalendar ID保持経路と矛盾|復旧操作で旧予定と新calendarを分離し得る|
|7|AUTH-07|P2|修復前のAPI失敗を0件成功として表示する経路|復旧に失敗しても再試行の判断ができない|
|8|GAP-08|P2|設定マスタの保存後にタブ往復すると旧初期値を再表示|保存できたか誤認し、旧値で再編集する候補|
|9|GAP-02|P2|Drive連携済みの名前保存とDrive操作でUI権限/GAS owner条件が不一致|部分成功と誤った成功/失敗表示|
|10|UI-04|P2|roles専任の利用者が設定/アカウント経由でロール画面へ到達できない|割り当てた管理責務を画面から実行できない|

### 次のGitHub Issue候補

Issueは作成していない。**1 Issue = 1責務**で次の順を推奨する。

1. AUTH-01: session登録と活動更新の境界・期限/失効不変条件を再現試験する。
2. AUTH-02: 重要操作RPCと再認証grantのDB契約を設計・拒否試験する。
3. AUTH-04: 一括削除の成功/失敗/未処理ID契約を再現する。
4. GAP-01: シフト更新error/影響行0を成功にしない契約を確認する。
5. AUTH-03、AUTH-05、AUTH-06、AUTH-07、AUTH-10はそれぞれ独立した再認証/復旧/失効Issueとして扱う。
6. GAP-08、GAP-02、UI-04、GAP-03、GAP-06をそれぞれ設定state、権限、導線、出力監査、検証のIssueへ分ける。
7. PERF-02/04/06は計測Issueから開始する。測定前に最適化PRや共通cache導入へ進めない。

## 現行実装と旧文書の差

以下は実装修正の依頼ではなく、次回計画を旧記述で立てないための注意点。

|文書等の記述|対象mainで確認した事実|
|---|---|
|通常保存のversion競合検出が未実装（gap-plan P5-2）|`src/app/actions/reports.ts` の `save_report_versioned` とhookのexpectedVersion/idempotencyKey受渡しが存在する。全競合経路の実証は別途必要|
|Google同期はevent IDのNULLが真実の源|`google_sync_status` のpending_upsert/failedも未同期選択に使う。旧コメントのNULL条件だけで判断しない|
|削除承認UIはreport限定|4Actionの現行UI呼出を発見できず、帳票の削除は別の直接論理削除経路（GAP-05）|
|バックアップは日次CSV/HTMLだけ|`scripts/backup/full-logical-backup.sh` とworkflowによる完全論理バックアップ経路も存在。運用実績は未確認|
|React Compiler有効|plugin依存はあるが `next.config.ts` に `reactCompiler` 指定、追跡対象にBabel設定を発見できない。有効性はbuildで確認が必要|
|初期実装の性能対策がない|Calendar/PDFのdynamic import、画面別Skeleton、request generation競合対策、統計Promise.allが存在する|

## runtime検証の優先順

1. **認証境界**: アイドル期限・絶対期限・管理失効後、`ensureSessionActivity`/token refreshを行って再利用できるか。複数端末、通信切断、OAuth再認証、password再認証後の元セッションを分けて検証。
2. **危険操作のDB境界**: 専用のowner/権限なし/別組織JWTでRPCを直接呼び、grantなし/別purpose/期限切れ/二重消費を拒否するか。アプリ画面を経た試験だけで完了としない。
3. **Google中断と復旧**: 3件以上の一括削除の途中で認証を失敗させ、未処理シフトのDB状態とGoogle予定を照合。再接続でcalendar IDを保持するか、invalid_grant/401/403/404/429/5xxの区別と修復結果表示を確認。
4. **保存結果**: Supabaseがthrowでなくerrorを返す失敗、影響行0、GASのみ失敗、設定タブ往復、create/update検証差を確認。
5. **件数・出力**: 帳票501件以上、統計/検索用CSV1,001件以上、完全バックアップとの差、CSV出力監査と制限を照合。
6. **性能・UI**: `performance.md` の合成データ計測、360px/200%拡大、キーボード、エラー読み上げ、設定タブ/ダイアログ、低速回線でのpending/empty/error。

E2Eは事前承認と専用Supabase環境が必要。今回の監査はこれらを実行していない。実環境の秘密値を監査文書へ貼らず、適用済migration・Auth設定・稼働件数・バックアップ成功時刻等の非秘密の証跡を収集する。

## 人間の判断が必要な事項

- MFA等の既存accepted-riskを変更するかは今回判断していない。受容済み方針と新規実装不備を混同しない。
- 再認証を「Google接続/解除」にも必須にするのか。system-decisionsの操作区分とgap-plan・現コードの要求を統一する必要がある。
- owner移管、削除申請/承認、復元・並び順等のBackend専用操作を画面へ公開するか。コード参照の少なさだけで削除しない。
- カスタム `roles` / `organization` / `integrations` 権限にどの設定導線とGAS操作を認めるか。owner限定方針との境界を決める。
- 設定保存方式をsection単位・即時保存・全体保存のどれに揃えるか。使用頻度・業務負荷は利用者への確認が必要。
- RLS/監査/失効の不備が実環境でも再現する場合の運用対応、Issueの優先度、限定提供の判断は責任者が行う。本書だけで本番適合・サービス停止を断定しない。

## 読んだ基準文書・外部仕様

ローカル `AGENTS.md`、対象SHAの `CLAUDE.md`、`README.md`、`.claude/rules/frontend.md` / `security.md` / `supabase.md` / `testing.md`、`docs/architecture.md`、`docs/system-decisions.md`、`docs/feature-overview.md`、`docs/implementation-gap-plan.md`、`docs/ui-system.md`、`docs/security-and-permissions.md`、`docs/compliance/README.md`。関連として `docs/ui-exceptions.md`、`docs/development.md`、`docs/compliance/control-matrix.md` の該当箇所、各領域の実装・テスト・現行migrationを確認した。

Context7（2026-09-02）でSupabase SSRのcookie/session refresh、getUser/getSession、Supabase Data APIの行数上限/range paginationと認証担当によるsignOut scopeを確認した。最新外部docsは一般仕様の補助に限り、CareRecord実装の証拠にはしていない。

lockfile上の主な実版: Next.js **16.2.9**、React **19.2.3**、`@supabase/ssr` **0.8.0**、`@supabase/supabase-js` / `@supabase/auth-js` **2.108.2**、googleapis **171.4.0**、google-auth-library **9.15.1**、TypeScript **5.9.3**。package.jsonの許容範囲とは区別した。
