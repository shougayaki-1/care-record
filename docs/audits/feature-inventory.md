# CareRecord Phase 0 機能棚卸し

監査日: 2026-09-02。対象: remote `main` のスナップショット `3cbae8813a872a100f6d980bab631b9ef5ea6a7c`。対象ディレクトリ: `/Users/shoug/Documents/Codex/2026-09-02/files-pasted-by-the-user-carerecord/work/main-snapshot`。

必須18領域に「自分の履歴」「manual」を加え、**20機能群**を棚卸しした。以下の `path:line` は上記スナップショット内の位置であり、稼働中の本番との一致を意味しない。Route、UI、Server Action、API、RPC、主要テーブル、認可、監査、テスト、ライフサイクルを各群に記載する。独立APIがない通常画面は、Next.js Server Action または Supabase browser client からのRESTを使う。

`CLAUDE.md`、`.claude/rules/*`、`docs/architecture.md`、`docs/system-decisions.md`、`docs/feature-overview.md`、`docs/implementation-gap-plan.md`を参照した。元ローカルの `/Users/shoug/Documents/GitHub/care-record/AGENTS.md` は作業指針として読んだが、対象mainに存在する実装証拠には数えていない。旧計画の「現状」はコードと照合した。`supabase/migrations/old/`、`ai_context_output/`は現行実装の根拠から除外した。

本書は静的調査である。テストファイル内の処理・assertionを読んだが、unit、DB、E2E、buildは実行していない。本番、外部Calendar、GAS、GCSに接続していない。「テストあり」は対象の試験記述がある意味で、成功・網羅性・本番設定の証明ではない。

## 判定の読み方

| 判定 | 意味 |
|---|---|
| ACTIVE | 現行画面または定期処理から実処理へ到達する配線を確認。完全性・本番稼働の保証ではない。 |
| POSSIBLY_INCOMPLETE | 配線はあるが、利用者の完了操作、下流整合、保全等に確認できる不足候補がある。 |
| POSSIBLY_UNUSED | 対象src内で定義・再export以外の利用を確認できない。外部呼出し、運用用途までは否定しない。 |
| INTENTIONALLY_FUTURE | 承認済み方針で延期・停止されている範囲。無断実装の対象ではない。 |
| UNCLEAR | 静的コードだけでは設定・運用・意図を確定できない。 |

主判定はACTIVE 12群、POSSIBLY_INCOMPLETE 8群。機能内の個別経路には別判定を添える。削除推奨の分類は行わない。

## 共通の入口と境界

- `src/app/app/layout.tsx:4` → `AppLayout`。画面の管理権限対応表は `src/components/layout/AppLayout.tsx:50`（accounts、roles、clients、staffs、reports、statistics、auditLogs、backupStatus）。これはUI側の制御であり、DB認可と区別した。
- Server Action共通認証は `src/utils/supabase/auth.ts:141` `getAuthedUser`、`:187` `assertOrgRole`、`:279` `assertOrgPermission`、`:454` `assertRecordPermission`、`:471` `assertShiftPermission`。権限定義は `src/utils/permissions.ts:4`、`:123`（scopeの最大値・managementのORで結合）。
- 通常のデータ取得にも browser Supabase 直読が残るため、Actionを通る経路だけで認可を評価しない。RLSの現行定義は基準migrationから後続置換を順に追った。特にclient/shiftの可視性は `20260716000019_fix_insert_returning_visibility.sql:28` と `:84`、セグメント更新は最終 `20260728000001_shift_segment_integrity.sql:1`。
- 監査ヘルパー `src/utils/supabase/audit.ts:35` は `audit_events` に追記し、失敗時にthrowする。ただし業務書込みと監査が別リクエストのActionも多い。ヘルパーが存在することと、全操作の原子性・拒否監査が成立することは別である。

## 01 認証／アカウント（ログインとセッション）

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/` → `src/app/page.tsx:10` `LoginPage` → `src/components/auth/AuthForm.tsx:80` `handleAuth`。パスワード登録・ログイン、Google OAuth、ログアウト。`IdleTimeout` は `src/components/layout/AppLayout.tsx:43` から利用。 |
| Server Actions | `src/app/actions/auth.ts:77` `registerWithPassword`、`:103` `loginWithPassword`、`:143` `recordLogout`、`:161` `heartbeatSession`、`:169` `ensureSessionActivity`。`AuthForm.tsx:94/114` が登録・ログインActionを呼ぶ。 |
| API / RPC | Supabase Auth `signUp` / `signInWithPassword`。OAuthは `src/components/auth/AuthForm.tsx:62` → `/auth/callback`（`src/app/auth/callback/route.ts:7`）。重要操作の再認証は `auth.ts:35/40` と `/auth/reauth-callback`。通常ログイン用の独自RPCはない。 |
| Tables | `auth.users`、`profiles`、`login_attempts`、`user_session_activity`。再認証に `reauth_grants`、`stepup_reauth_challenges`、`oauth_nonces`。 |
| Permission | 未ログインの認証入口。以後はJWTとサーバー活動記録の照合。登録は `auth.ts:83` で直接 `signUp` しており、このAction内に招待コード照合はない。 |
| Audit | `auth.register`、`auth.login`、`auth.logout`（`auth.ts:86/93/117/133/149`）。`recordAuthAuditSafely`（`:69`）およびlogout catchは監査失敗を継続し得る。 |
| Tests | `tests/auth.spec.ts:7/22` は未登録ログインの汎用エラーと8文字未満のUI検証。`src/utils/passwordPolicy.test.ts:5` は8文字のみの要件をassert。`src/utils/clientLogout.test.ts:44/52` は失効・global signOut・ローカル消去とサーバー失敗時の継続。`stepupReauth.test.ts:32/42/54` はnonce不正、別アカウント、成功のmock試験。いずれも未実行。 |
| Lifecycle | **POSSIBLY_INCOMPLETE**。通常認証の配線は存在するが、自由登録を許可しない方針と登録入口の制限を照合する必要がある。MFAは `docs/system-decisions.md` のaccepted-riskであり **INTENTIONALLY_FUTURE**。 |

## 02 利用者管理

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/clients` → `src/app/app/clients/page.tsx`。登録後 `/app/clients/[id]` でフォーム、担当スタッフ、帳票連携を設定。`src/app/app/clients/[id]/page.tsx:427` の3タブ、`:462` `StaffAssignmentTab`。 |
| UI → 保存 | 一覧の追加・名称変更・アーカイブ・論理削除 → `src/app/actions/clients.ts:30/45/58/76`。担当保存 → 同ファイル`:136`、Googleリンク保存 → `:171`。browser側読取りは `clients`、`staffs`、`form_templates` など。 |
| Actions / API | `createClient`、`updateClientName`、`setClientArchived`、`softDeleteClient`、`saveClientAssignments`、`updateClientGoogleLink`、`getClientAssignmentPermissionHints`。独立APIなし。 |
| RPC / Tables | `replace_client_assignments_authorized`（最新定義 `supabase/migrations/20260716000008_clients_staffs_rls.sql:79`）と `get_client_assignment_permission_hints_authorized`（`:162`）。`clients`、`client_staff_assignments`、`assignments`、`staffs`、`organizations`。 |
| Permission | mutationは `management.clients`、`assertClientOrg`（`clients.ts:11`）で組織と対象確認。担当RPCで別組織のstaffを検証。client読取りの現行RLS補助は `20260716000019_fix_insert_returning_visibility.sql:28/59`。 |
| Audit | `client.create/rename/archive/restore/soft_delete/assignments_update/google_link_update`（`clients.ts:40/53/68/98/162/186`）。保持期限を付ける論理削除（`:84-93`）。 |
| Tests | `tests/admin-features.spec.ts:6-27` は追加→詳細遷移→フォーム保存→一覧表示。`src/app/app/clients/[id]/page.test.tsx:58` は権限hint取得失敗でも氏名が出るmock試験。`supabase/tests/security_hardening.test.sql` 後半はinsert-returningと異組織可視性を扱う。全CRUD網羅の証明ではない。 |
| Lifecycle | **ACTIVE**。登録・詳細設定・ライフサイクル変更への画面配線と永続化を確認。 |

## 03 提供記録（作成・送信・編集・承認・画像）

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/record` 選択（`src/app/app/record/page.tsx:50/70/79`）→ `/app/record/[clientId]`（`:17` `useRecordForm`、`:52-67` 承認/取消/下書き/送信）。`RecordMetaForm`、`RecordDynamicSections`、`MonthSplitTabs`、`ShiftSuggestions`、`AiImportButton`、画像添付。 |
| UI → 保存 | `src/hooks/useRecordForm.ts:956` → `saveReport` に実施サービス、実施staff、入力値、expectedVersion、idempotencyKey。`:975`でversion更新。自動保存 `:828`、画像 `:899`、削除 `:915`、承認/差戻し `:1014/1029`。 |
| Actions / API | `src/app/actions/reports.ts:99/118/133` 自動保存save/load/discard、`:141` 本保存、`:206` 遷移、`:232` 論理削除、`:310/379` 画像upload/view、`:407` 閲覧監査。画像はSupabase Storage API、独立記録APIなし。 |
| RPC / Tables | `save_report_versioned` → `save_report_atomic_v2` → `save_report_atomic`。前者の最新本体 `20260716000007_release_readiness_foundation.sql:185`、内部実装は `20260630235959_init.sql:767/1082`。`reports`、`report_values`、`report_actual_staffs`、`report_shifts`、`record_versions`、`report_mutation_keys`、`report_corrections`、`report_autosaves`、`report_images`、`report_image_upload_events`、非公開 `report-images` bucket。自動保存・状態遷移のRPCは `20260716000011_reports_roles_rls.sql:77/106/121/128`。 |
| Permission | 編集・承認・削除scopeはActionとDBで検証。本保存Actionは認証後に認可内包RPCへ委譲。画像は `getAccessibleReport`（`reports.ts:296`）を経由、5分署名URLは`:390`。承認は `management.reports` と `records.approve`。 |
| Audit | 本保存成功は内部RPCの `audit_events` insert（init`:1071`）と履歴capture（`:1070`）。Action側で `report.save`失敗、`report.bulk_approve/remand`、`report.soft_delete`、`report_image.upload/view`、`report.view`。 |
| Tests | `useRecordForm.test.tsx:125` は遅い旧記録応答による上書きを防ぐ、`:151` draftKey補完。`record/page.test.tsx:58` はshift取得失敗時のclient表示。`tests/staff-features.spec.ts:7-43` は送信・履歴表示、`integration-flow.spec.ts:86-109` は送信→承認。`rpc_contracts.test.sql:98-104` はversioned RPCの入口エラー、`:222-236` はGRANTを検査し、競合・冪等再送の実保存fixtureは作らない。 |
| Lifecycle | **POSSIBLY_INCOMPLETE**。通常保存の楽観ロックは実装済み（foundation`:247`）。競合時UIは差分画面ではなくトースト（hook`:992`）。訂正理由パラメータ・`report_corrections`はあるが、通常UIはcorrectionReasonを送らず、承認取消後の再編集と正式訂正版ワークフローの関係が未完。 |

## 04 記録フォーム設定

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/clients/[id]` の記録フォームタブ → `src/components/clients/FormBuilderTab.tsx`。`src/app/app/clients/[id]/page.tsx:447`、`:486` の保存ボタン。標準テンプレート・他利用者コピーは`:491`以降。 |
| UI → 保存 | `saveClientForm`（`src/app/actions/clients.ts:107`）→ `upsert_client_form_authorized`（`:118`）。記録入力は `useRecordForm` が `form_templates` を読み `RecordDynamicSections` に反映。 |
| API / RPC / Tables | 独立APIなし。RPC最新定義 `supabase/migrations/20260716000008_clients_staffs_rls.sql:41`。`form_templates.schema` と `clients`。標準値は `src/constants/formTemplates.ts`。 |
| Permission | `management.clients`、対象clientの組織検証。DBもRPC内で権限・組織を確認。 |
| Audit | `client.form_update`（`clients.ts:127`）。 |
| Tests | `tests/admin-features.spec.ts:6-22` が実UI上の利用者追加とフォーム保存を操作し、保存メッセージをassert。全field型、schema変更後の既存記録表示、複製整合の網羅は確認できない。 |
| Lifecycle | **ACTIVE**。フォーム編集・保存・入力画面での消費まで接続している。 |

## 05 シフト

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/shifts/manage`（`src/app/app/shifts/manage/page.tsx:64`）と `/app/shifts/my`（`src/app/app/shifts/my/page.tsx:108`）。`ShiftCalendarViewer`、`ShiftFormModal`、`ShiftPatternModal`、`ShiftSegmentEditor`、`useShiftData`、`useSyncProgress`。管理画面`:173/244/272/292`に単発保存、ひな形保存、月次preview/生成。 |
| Server Actions | `src/app/actions/shift.ts`は再export入口。実体は `shifts/crud.ts:58/85/119/144/171/231/260`（作成、更新、時刻、cancel、一覧、batch削除、個別論理削除）、`patterns.ts:13/46/64/88`、`generation.ts:26/95`、`myShifts.ts:8`、`shiftSegments.ts:64`。 |
| API / RPC | 独立シフトAPIなし。`create_shift_with_segments_atomic`、`replace_shift_segments`、`save_generated_shift_atomic`の最終定義は `20260728000001_shift_segment_integrity.sql:73/1/41`。ひな形は最終 `20260721000002_require_pattern_segment_staff.sql:6` `save_shift_pattern_atomic`。削除 `soft_delete_shifts_atomic` は `20260716000013_shift_generation_rls.sql:3`。 |
| Tables | `shifts`、`shift_staffs`、`shift_segments`、`shift_segment_staffs`、`shift_patterns`、`shift_pattern_staffs`、`shift_pattern_segments`、`shift_pattern_segment_staffs`、`clients`、`staffs`、`service_types`、`staff_roles`、`report_shifts`。segment staffから派生staffとタイトルを更新するtriggerは `20260713000005...:121`、`20260722000002_refresh_shift_title_from_staffs.sql:3`。 |
| Permission | view/create/edit/delete scope。月次生成などは`all`必須。最新segment RPCは稼働session、組織、staff/service/role境界、既存記録が参照するsegment保護を検証（7月28日`:7-33`）。 |
| Audit | `shift.create/update/time_update/cancel/reopen/soft_delete/bulk_soft_delete`、`shift_pattern.create/update/soft_delete`。Google同期イベントは別群参照。PDF出力は管理画面`:379/400`→`shiftPdfExport`でbrowser生成し、この呼出しに出力監査Actionはない。 |
| Tests | `useShiftData.test.tsx:58-99` は組織切替後の古いmaster応答抑止。`shifts/helpers.test.ts:6/12/20` は時刻・staff重複・segment整形。`shiftRecurrence.test.ts`、`shiftSegments.test.ts`、`shiftTitle.test.ts`は純関数試験。今回確認したE2Eに月次生成→segment→再同期の一連試験はない。 |
| Lifecycle | **ACTIVE**。主業務は画面からDBへ配線。保守用 `shiftRepair.ts:30/70`、`deleteShiftsDbOnly` は **POSSIBLY_UNUSED**（srcで定義/再export以外なし）。 |

## 06 Google Calendar連携・同期

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/settings` 接続/再認証/解除（`page.tsx:341/376`）、未同期再試行 `:437`、修復 `:468`。シフト管理からも `useSyncProgress`。 |
| Actions / API | `src/app/actions/google.ts:18/50` 接続health/OAuth URL、`organization.ts:54` 解除、`shifts/googleSync.ts:36/70/180/319` 状態/未同期batch/修復/単件。`/api/google/callback` `route.ts:13` がcode交換→calendar設定→`:144`保存。外部Google Calendar APIを使用。 |
| RPC / Tables | `get_google_sync_target`、`mark_shift_google_sync`、`update_google_connection_health`、`get_google_oauth_context`、`complete_google_oauth_connection`（`20260716000016_google_sync_rls.sql:4/23/42/53/67`）。`organizations`の暗号化refresh token・calendar ID・health、`shifts.google_event_id/google_sync_status/google_sync_error/google_synced_at`、`oauth_nonces`。 |
| Permission | 連携は `management.integrations`。`google.ts:59-76` は再認証grantまたはGoogle SSO identity一致経路。同期batch/repairは `shifts.edit=all`、単件は対象shiftのedit/delete。nonceをcookieとDBで管理。 |
| Audit | `integration.calendar.connect/disconnect/sync`（callback`:156`、organization`:74`、googleSync`:97/155/304/325`）。同期失敗をDBの状態へ残し、`googleSyncInternal.ts:36`で一時エラー再試行、`:269`で対話操作の同期エラーを扱う。 |
| Tests | `src/utils/googleSync.test.ts:44-151` は認証・rate limit・一時エラー分類、`:223-272` event payload、`:295-366` 署名・重複代表選択。実OAuth callback、token復号、外部API retry、repairのDB更新までの試験成功は未確認。 |
| Lifecycle | **ACTIVE**。旧architectureの「event_id NULLのみが同期状態」は現行と不一致でstatus列がある。`forceSyncBatch`は再exportのみで **POSSIBLY_UNUSED**。接続に再認証を要求しない承認方針と現行要求の差異は別途判断対象。 |

## 07 帳票・提供記録一覧・Google Drive/GAS

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/reports` → `src/app/app/reports/page.tsx:5` → `ReportsClientPage`。一覧・filter・選択・承認・差戻し・削除・CSV・PDF/ZIP・GAS生成。`src/hooks/useReportFilters.ts`、`ServiceRecordDocument`、`reportZipExport`。 |
| UI → Action | `ReportsClientPage.tsx:128` browser query、`:167/179/202` 承認/差戻し/論理削除。CSV`:225`、PDF`:252`はいずれも `auditReportExport` を先に呼ぶ。GAS帳票`:347-447` → `callGasApi`。 |
| API / RPC / Tables | 独立帳票APIなし。状態変更RPCは記録群参照。`reports`、`report_values`、`report_actual_staffs`、`clients`、`form_templates`、`report_shifts`。Drive生成は `src/app/actions/gas.ts:116` → `GAS_API_URL`にHMAC署名POST、`manage_*_folder/create_sub_folder/create_template_doc/create_pdf`。保存先IDはclient/orgから再取得。 |
| Permission | 一覧UIは `management.reports`。CSV/PDF監査Action `reports.ts:425` はreports権限確認。GASは `gas.ts:120-123` のmembership（org folderのみowner）と対象データRLSで確認し、Action種別ごとのmanagement権限照合はない。 |
| Audit | `report.export_csv/pdf`（ZIP化するPDF群もformatはpdf）の監査Action、`google_drive.<action>`成功/失敗（`gas.ts:162/172`）。`auditReportExport`のformat型は `reports.ts:421`。出力の監査呼出しがあることと、生成完了監査・すべての派生出力の監査があることは別。 |
| Tests | `reportsExport.test.ts:30-66` は実施担当優先、配列/オブジェクト値、動的列、quote処理。`integration-flow.spec.ts:98-109` は一覧から承認。GASやPDF内容・ZIP・実際のファイル出力の試験はこれらに含まれない。 |
| Lifecycle | **POSSIBLY_INCOMPLETE**。主要一覧/出力は接続済み。削除申請Action群は画面未接続で、一覧は直接 `softDeleteReports` を呼ぶ。`restoreReports`にも画面呼出しなし。GASの権限粒度も要照合。 |

## 08 AI取込

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/ai-import`（`page.tsx:136`）の画像/PDF upload→group→抽出→`AiImportReviewTable`→選択draft保存。記録画面の `AiImportButton` でも抽出値をフォームへ反映する。`layout.tsx:4` はfeature flag無効時notFound。 |
| API / 保存 | `page.tsx:109/310` → `POST /api/ai/extract?organizationId=...`。`route.ts:156` Vertex `generateContent`、`:180` Zod parse、SSE `record/error/group_done`。レビュー後 `page.tsx:403` → `saveReport` →記録RPC。 |
| RPC / Tables | 抽出APIは記録を直接保存しない。下書き保存は `save_report_versioned`、記録関連tableと `audit_events`。画像は再エンコード、PDFはbytesをVertexへ渡す（`route.ts:136-145`）。 |
| Permission | flagを認証/body解析前に検査（`:20`）、`getAuthedUser`と`assertOrgRole`（`:35-38`）。抽出自体はrecords.create等でなく所属判定。永続化は記録RPCの認可。 |
| Audit | `ai_import.started`（`:82`）と `ai_draft.created`（`reports.ts:188-200`）。開始監査エラーはcatchで継続（route`:91`）。 |
| Tests | `validation.test.ts` は件数、MIME、サイズ、group index正規化。`extractSchema.test.ts:101/117/135` は抽出型、confidence、複数記録。`sseClient.test.ts:17` は分割chunk。**`api/ai/extract/route.test.ts:4` はformatSseEventの試験でPOST全体の試験ではない**。feature無効時Vertex未初期化は `gemini.test.ts:19`。 |
| Lifecycle | **POSSIBLY_INCOMPLETE**。抽出→レビュー→draftは接続。bulk保存は選択staffを `values._helpers` 名称に入れるが、`actualStaffs`を送らない（page`:403-414`、reports`:172` default `[]`）。正式staff関連への反映、APIの権限粒度、PDFの安全化は個別評価が必要。本番のflag値は **UNCLEAR**。 |

## 09 内勤

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/internal-work`（`src/app/app/internal-work/page.tsx:35`）、`InternalWorkDialog`（`src/components/internal-work/InternalWorkDialog.tsx:48`保存）。月選択、staff絞込み、一覧、新規登録。 |
| Actions / API | `getInternalWorkPageData`（`src/app/actions/internalWork.ts:179`）、`listInternalWorkRecords`（`:147`）、`saveInternalWork`（`:99`）。統計側は `listInternalWorkRecordsForStatistics`（`:273`）。独立API/RPCなし、session clientでinsert/select。 |
| Tables | `internal_work_records`、`staffs`、`organization_members`、`organization_member_roles`、`organization_roles`。保存は`:127-139`で固定 `status='pending'`。 |
| Permission | Actionの `getInternalWorkPermission`（`:40`）はview/createのall/assigned/noneと本人staff紐付け。DB insert policyは `20260716000012_internal_stats_gas_rls.sql:6`（session、recorded_by、staff所属、scope）。統計読取り用policyは`:27`。 |
| Audit | `saveInternalWork`本体に `recordAuditEvent` 呼出しなし。現行migration検索でも内勤専用の監査triggerを確認できない。 |
| Tests | `statisticsAggregation.test.ts:31-85` は内勤を含む月跨ぎ集計結果をassert。内勤保存Action、view/create境界、dialogの統合試験は確認できない。 |
| Lifecycle | **POSSIBLY_INCOMPLETE**。登録/一覧/統計は接続。status型はpending/approved/remandedだが、この機能の承認・差戻し・編集・削除Action/UIはない。`InternalWorkAction`自体がview/createのみ（permissions`:7`）。意図した範囲かを確定する必要がある。 |

## 10 スタッフ（名簿）

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/staff` `src/app/app/staff/page.tsx:66`。一覧、名称/雇用/勤務形態/職種/ユーザー連結の編集、archive/restore、並替え、職種候補管理。 |
| UI → 保存 | `page.tsx:142` → `saveStaff`、`:168/174/178` 論理削除/archive/restore、`:184/197` 職種候補、`:223` 並替え。 |
| Actions / API | `src/app/actions/staffs.ts:75/114/126/149/168/183/204`。独立APIなし。ユーザー連結の同組織/二重連結検証は`:65-73`。 |
| RPC / Tables | `reorder_staffs_authorized`（最新 `20260716000008_clients_staffs_rls.sql:131`）。`staffs`、`staff_position_presets`、`organization_members`、`profiles`。履歴用のstaff rowを保持しdeleted/archived状態を更新。 |
| Permission | mutationは `management.staffs`、対象staffの組織照合 `assertStaffOrg`（`:58`）。名前候補読取りは所属判定とRLS。 |
| Audit | `staff.create/update/archive/restore/soft_delete/reorder`、`staff_position_preset.create/delete`（`:103/121/144/157/199/214`）。 |
| Tests | `tests/admin-features.spec.ts:40` は名簿メニュー表示まで。スタッフ保存・archive復元・二重ユーザー連結を直接assertする専用試験は確認できない。スタッフを使う記録/統計試験は当機能CRUDの代替ではない。 |
| Lifecycle | **ACTIVE**。画面の各mutationから永続化まで接続。ログインアカウントと名簿staffは別概念。 |

## 11 統計・予実管理

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/statistics`（`page.tsx:107`）、`StaffReportTable`、`ShiftVarianceTable`。月、staff別/client別、予定/実績/内勤、差異、CSV。 |
| UI → Action | `page.tsx:133` → `getStatisticsData`（`src/app/actions/statistics.ts:15`）が並列取得 → `src/utils/statisticsAggregation.ts`で集計。CSVは `page.tsx:253-262` のbrowser `buildStatisticsCsv`→Blob。 |
| API / RPC / Tables | 独立API/RPCなし。`shifts`、`shift_staffs`、`shift_segments`、`shift_segment_staffs`、`reports`、`report_values`、`report_actual_staffs`、`report_shifts`、`labor_premium_types`、`internal_work_records`、`clients`、`staffs`、`profiles`。日時overlap取得はstatistics`:41/57`。 |
| Permission | Actionに `management.reports`（`:20`）、session client+RLS。内勤統計もreports権限を再確認。 |
| Audit | `getStatisticsData`およびCSV handlerに専用監査呼出しなし。 |
| Tests | `statisticsAggregation.test.ts:18/31/88/167/191/207/247` は空入力、月跨ぎ、segment差異、実施staff優先、CSV列等を具体値でassert。`laborPremium.test.ts:5/18/22/65` は深夜・超過・変形・予定実績比較。DB取得権限や実CSVダウンロードの検証ではない。 |
| Lifecycle | **ACTIVE**。DB取得→集計→表示/CSVまで配線。CSV出力の監査有無は帳票出力と揃っていないため別途評価。 |

## 12 バックアップ・復元・保持期限

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/backup`（`page.tsx:75`）、日次ファイル一覧、検索、詳細閲覧、直近cron、手動生成（`:122/149/167`）。UI復元ボタンは確認できない。 |
| Actions / API | `src/app/actions/backup.ts:47/71/102/139` `getLastBackupRun/listDailyBackups/getBackupRecords/triggerDailyBackup`。`/api/cron/backup-daily`、`backup-monthly`、`purge`。業務CSV/HTMLと完全論理DBバックアップは別経路。 |
| RPC / Tables / 保存先 | UIは `audit_events`、`clients`、`form_templates`、GCS daily CSV/HTML。`src/utils/gcs/export.ts`がreportをexport。完全backupは `.github/workflows/full-backup.yml:5/72`→`scripts/backup/full-logical-backup.sh:31-46`でroles、DB dump、migration一覧、Storage metadataを取得、`:66-77` manifest/GCS保存。DB側の復元証跡は `backup_restore_tests`。 |
| Permission | UI/Actionは `management.backupStatus`。cronはBearer `CRON_SECRET`。完全backupはGitHub Environment/OIDC。復元スクリプトは隔離環境と明示確認値を要求（`restore-logical-backup.sh:8-15`）。通常session clientでなく用途限定service-role/GCS権限を用いる。 |
| Audit | `backup.view`、`backup.manual_trigger`（backup`:113/134/164`）、dailyの`backup.cron_run`。完全backupはreceipt artifact、復元は `restore-logical-backup.sh:116` のDB証跡。 |
| Tests | `gcs/html.test.ts:6` は利用者入力をtextContent/script-safe JSONで扱うassert。`retention.test.ts:5` は物理削除有効化を拒否。`verify-backup-manifest.sh:16`はhash検証コードだが今回未実行。実復元成功・14h/26hの運用証跡は未取得。 |
| Lifecycle | **POSSIBLY_INCOMPLETE**。完全論理backupのworkflow/scriptは現行に存在し、旧gap-planの「CSV/HTMLのみ」は不正確。一方このscriptが保存するStorageはinventory/metadataで、画像bytesの完全複製とは区別が必要。purgeは `retention.ts:26-29`でdry-run固定・物理削除拒否の **INTENTIONALLY_FUTURE**。稼働世代/復元実績は **UNCLEAR**。 |

## 13 監査ログ

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/logs` `src/app/app/logs/page.tsx:38`、Supabase監査/Cloud Loggingタブ、期間検索、CSV（`:63/78`）。 |
| Actions / API | `src/app/actions/organization.ts:144/164/228` `getAuditLogs/exportAuditLogsCsv/listCloudLogEntries`。定期保全 `/api/cron/archive-audit`（`route.ts:17`）。 |
| RPC / Tables | 独立監査RPCなし。`audit_events`、`profiles`、`audit_archive_checkpoints`。DB chain triggerは `20260630235959_init.sql:258/2313`、更新削除禁止は`:754/2317`。外部保全はGCSまたはHMAC endpoint（archive route`:41/52`）。 |
| Permission | 閲覧/出力Actionは `management.auditLogs`、組織filter。archiveはcron secret+監査用service role。 |
| Audit | CSVは `audit.export`（organization`:192`）、archiveは`audit.archive`（route`:65`）。閲覧自体・すべての拒否/失敗が記録されるとは確認できない。 |
| Tests | `supabase/tests/security_hardening.test.sql:58/59` はhash chain/append-only triggerの存在をassertする。実chain全件再計算・外部archive往復・障害時原子性の試験ではない。 |
| Lifecycle | **POSSIBLY_INCOMPLETE**。閲覧/CSV/外部保全は配線。archiveは1回500件（`:29`）、checkpoint境界処理（`:30-35`）と滞留時の追いつき能力は別検証が必要。監査失敗時の原子性は業務別に差がある。UIの「本日分しか残らない」コメント（logs`:42`）は保持期間の実装根拠ではない。 |

## 14 アカウント・ロール・権限管理

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/accounts` のaccounts/rolesタブ（`page.tsx:126`）、`/app/settings/roles` → `RoleManagementPanel`。`RolePermissionsMatrix`、`ColorPresetPicker`、招待dialog、account編集。 |
| UI → Actions | accounts`:133`招待→`createInvitation`、`:191/198`基本role/複数role更新、`:237`削除。`src/app/actions/accounts.ts:50/181/220/245/338`。role CRUD/resetは `src/app/actions/roles.ts:39/58/89/110`。 |
| API / RPC | 独立APIなし。招待RPC最終 `20260719000020_invitation_dangerous_role_owner_guard.sql:4`。`account_update_role/account_remove`は `20260716000009_accounts_workspace_rls.sql:34/65`。複数role置換は最終 `20260719000040_dedupe_account_role_safety.sql:3`。role mutationは最終 `20260718011838_fix_last_role_manager_owner_check.sql:16`。 |
| Tables | `organization_members`（owner/member）、`organization_roles`、`organization_member_roles`、`invitations`、`staffs`、`profiles`、`organizations`。staffの職務役割 `staff_roles` と権限roleは別。 |
| Permission | `management.accounts`と`management.roles`を分離。危険権限の付与にowner条件、最後のrole管理者保護（`roles.ts:42/68-69/97`、accounts`:340`）。権限merge/role安全性は共通utilityにも存在。 |
| Audit | `account.invitation_create/role_update/roles_update/remove/invitation_revoke`、`role.create/update/delete/preset_reset`。変更内容を監査へ記録（roles`:50/77/103/126`）。 |
| Tests | `roles.test.ts:30/37/48/62` は非owner危険role拒否、owner許可と監査、metadataのみ変更時の既存権限検査。`roleSafety.test.ts:39` は明示roleなしownerも管理者として数える。`rpc_contracts.test.sql:109-141/185-214` は実DBでrole作成/付与のowner境界・member不存在をassert。`integration-flow.spec.ts:33/47` はrole作成→招待URL。 |
| Lifecycle | **ACTIVE**。CRUDと招待の主経路は接続。所有権移管 `organization.ts:101` はAction/RPC/DB試験があるが現行srcのUI呼出しなしで、個別経路は **POSSIBLY_INCOMPLETE**。 |

## 15 組織設定

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/settings`。名称、交通費単価、Drive/Calendar、サービス種別、スタッフ職務役割、労働時間ルール、退出、組織削除。`page.tsx:30-33` の3設定componentと `getSettingsSectionsData`。 |
| Actions | `organization.ts:12/23/34/78/92` 名称/Drive/交通費/削除/退出。`settingsSections.ts:12`一括read。`serviceTypes.ts:29/41/58`、`staffRoles.ts:30/47/64`、`laborPremium.ts:16/43/72` 各設定mutation。 |
| API / RPC / Tables | 設定RPC `update_organization_setting`（最終 `20260716000015_org_deletion_rls.sql:60`）、`soft_delete_organization`（`:83`）、`leave_organization_atomic`（`:100`）。master作成は foundation `:418/434/450` の `create_service_type_atomic/create_staff_role_atomic/create_labor_premium_type_atomic`。`organizations`、`service_types`、`staff_roles`、`labor_premium_types`、membership。 |
| Permission | 通常設定は `management.organization`、連携は`integrations`。削除はownerかつ`organizationDelete`、再認証grant。UIも `page.tsx:527-529`で分岐。 |
| Audit | 名称/単価/連携は `organization.update/organization.travel_cost_update/integration.drive.*`。サービス種別・職務役割・労働時間ruleのActionには明示監査呼出しなし。名称/連携と同じ監査粒度ではない。 |
| Tests | `laborPremium.test.ts`は計算結果の試験で設定保存の試験ではない。`rpc_contracts.test.sql:147-177`は所有権移管拒否/成功とowner/member変更をassert。3master設定のUI→DB往復試験は確認できない。 |
| Lifecycle | **ACTIVE**。各設定componentからAction/永続化が接続。連携や所有権/削除は独立の認可・再認証レビューを要する。 |

## 16 profile（自分のアカウント設定）

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/profile` `src/app/app/profile/page.tsx:34`。氏名、avatar、password/email変更、Google/Azure identity連結、退会。 |
| UI → 保存 | `page.tsx:91` → `updateOwnProfile`、`:124`→`uploadOwnAvatar`、`:138`→`deleteUserAccount`。password/email/identityは`:93/109/147`でbrowser Supabase Auth直接呼出し。 |
| API / RPC / Tables | Auth `updateUser/linkIdentity`。自己削除RPC `request_own_account_deletion`（`20260716000009_accounts_workspace_rls.sql:129`）。`profiles`、`auth.users`、`user_deletion_requests`、`staffs`、`organization_members`、Storage `avatars`。avatarはWebP安全化後public URLを保存（`src/app/actions/user.ts:54-69`）。退会は申請、profile論理削除、staff連結解除、membership削除のRPC後にAuth ban（`:81-92`）。 |
| Permission | 対象IDは `getAuthedUser` 由来。プロフィール・avatarはsession client/RLS。Auth banのみ限定service-role用途。 |
| Audit | `account.self_delete_request`（user`:85`）。氏名/avatar/password/email更新・identity連結に同一の監査Actionは確認できない。 |
| Tests | `passwordPolicy.test.ts:5/14` は最小長のみと説明文。`clientLogout.test.ts`は退会後に使うlogoutのmock試験。profile変更後の他端末失効・メール二重確認・avatar→profile関連の実試験は未確認。 |
| Lifecycle | **POSSIBLY_INCOMPLETE**。更新経路はあるが、password/email変更後の他端末失効・email変更再認証の明示配線が見えない。退会UIは「完全削除・復元不可」（page`:136`）と説明する一方、実装は削除申請＋banで、説明と結果が不一致。 |

## 17 super-admin

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/super-admin`、layoutでprofile.role確認（`src/app/super-admin/layout.tsx:20-31`）。dashboard `page.tsx:30` が一覧Actionを呼ぶ。組織名、登録日、staff/client件数、状態を表示。 |
| Actions / API / RPC | `src/app/actions/super-admin.ts:12` `getAllOrganizations`。独立API/RPCなし。service-role platform metadata clientでread。`:47` `deleteOrganization`は常に拒否するstub。 |
| Tables | `organizations` と `profiles(count)`、`clients(count)`。返却内容は `super-admin.ts:37-43`。 |
| Permission | UIだけでなくActionに `assertSuperAdmin`（`:13`）、共通実装 `src/utils/supabase/auth.ts:232`が現在ユーザーのprofile.roleを確認。 |
| Audit | 一覧Actionに監査書込みなし。 |
| Tests | super-admin dashboard/Actionの専用テストは確認できない。共通RLS/権限テストをsuper-adminの全機能試験とは扱わない。 |
| Lifecycle | **ACTIVE**。metadata閲覧として配線。削除stubは到達しても拒否しUI呼出しなしの **POSSIBLY_UNUSED**。staffCountは名簿`staffs`ではなく`profiles`集約由来で、指標名称との整合確認が必要。 |

## 18 onboarding（setup・招待参加・組織解決）

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/join?code=...`（`src/app/join/page.tsx:20/36`）でpreview・ログイン状態 → `/setup`（`src/app/setup/page.tsx:20`）で氏名/同意、組織作成または招待参加。`/app`はworkspaceを解決して記録へ。 |
| Actions | `setup/page.tsx:122/135/147` → `updateOwnProfile/createOrganization/acceptInvitation`。`accounts.ts:281` `getInvitationPreview`、`:157` `acceptInvitation`。`workspace.ts:26` `getMyWorkspaces`、user`:33` `setLastOrganization`。 |
| API / RPC / Tables | `get_invitation_preview`（最新 `20260716000009_accounts_workspace_rls.sql:140`）、`accept_invitation_atomic`（最終 `20260716000014_invitation_hardening.sql:71`）、`create_organization`（foundation`:487`）。`profiles`、`organizations`、`organization_members`、`organization_roles`、`organization_member_roles`、`invitations`、`staffs`。 |
| Permission | previewはコード限定でanon EXECUTE、招待受領は認証・メール一致・期限/消費状態をRPCで検証。組織作成Actionは認証済み利用者を要求。最終RLS/容量guardと初期owner設定はRPC側。 |
| Audit | 招待作成は `account.invitation_create`。受領RPCは同一トランザクション内で参加監査を記録。プロフィール同意Actionの専用監査はない。 |
| Tests | `tests/setup.spec.ts:9-45` は新規登録→氏名→組織作成→アプリ表示。`integration-flow.spec.ts:47-78` は招待URL→登録→参加→記録画面。`workspace-routing.spec.ts:5-19` は既存アカウント再ログインでsetup誤遷移しないこと。期限切れ/再発行/メール不一致等の全受領境界をこのE2E群が網羅するわけではない。 |
| Lifecycle | **ACTIVE**。作成/参加/既存所属解決の一連経路あり。自由登録と初期ownerセットアップの運用制限は認証群の不足候補として扱う。 |

## 19 自分の履歴

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/app/history` `src/app/app/history/page.tsx`。リスト/カレンダー、期間、記録詳細へ遷移。`:107`で履歴取得。 |
| Actions / API / RPC | `src/app/actions/reports.ts:27` `getMyReportHistory`。独立API/RPCなし。本人staff mappingを解決後、reportと実施staffをinner join。 |
| Tables / Permission | `staffs.user_id`→`reports`・`report_actual_staffs`・`clients`。所属assert＋RLS、draft/削除済み除外、最大100件（`:31-53`）。入力者`helper_id`ではなく実施担当を使う。 |
| Audit | 一覧専用監査なし。詳細へ入ると記録画面の `auditReportView`経路。 |
| Tests | `tests/staff-features.spec.ts:40-43` が送信後の履歴に利用者/承認待ち表示をassert。実施staffと入力者が異なるケース、staff mapping欠落、100件超のページング試験は未確認。 |
| Lifecycle | **ACTIVE**。実施担当基準の一覧として接続。最大100件・ページングなしは仕様/UX確認対象。 |

## 20 manual（サポートマニュアル）

| 項目 | 現行経路・根拠 |
|---|---|
| Route / UI | `/manual` `src/app/manual/page.tsx:95` `ManualPortalPage`、独立layout。章一覧は`:75-90`、登録/権限/記録/AI/シフト/帳票/設定/監査等。 |
| Actions / API / RPC / Tables | 実業務保存のAction/API/RPCなし。静的文章と説明UI。業務tableへ保存しない。 |
| Permission | manual layoutに業務権限assertなし（`src/app/manual/layout.tsx:6`）。説明コンテンツであり顧客データ閲覧画面ではない。 |
| Audit | 専用監査なし。 |
| Tests | manual章・リンク・説明と本体挙動の一致を検証する専用テストは確認できない。 |
| Lifecycle | **ACTIVE**。サポート画面として存在。本文の説明は実装証拠に代用せず、機能変更と同時に差分確認する対象。 |

## 未接続候補と意図的延期の追跡

`rg`で対象`src`全体を検索した結果。外部利用・運用者からの呼出し有無は未確定であり、削除提案ではない。

| 対象 | 分類 | 根拠・次の確認 |
|---|---|---|
| `src/app/actions/deletionRequests.ts:30/53/67/102` | POSSIBLY_INCOMPLETE | 申請/一覧/承認/却下Actionと `request_report_deletion/decide_report_deletion` はあるがUIから呼ばれない。最新RPCは `20260716000015_org_deletion_rls.sql:17/31`。画面は直接論理削除を実行する。 |
| `src/app/actions/reports.ts:273` `restoreReports` | POSSIBLY_UNUSED | 定義以外のsrc呼出しなし。復元UIの要否、削除済み一覧導線を確認する。 |
| `src/app/actions/organization.ts:101` `transferOwner` | POSSIBLY_INCOMPLETE | Action/RPC/DB試験はあるがUI呼出しなし。membership role編集はowner移管の代替とは限らない。 |
| `src/app/actions/shiftRepair.ts:30/70` | POSSIBLY_UNUSED | preview/applyの間の内部呼出し以外を確認できない。`maintenance_runs/maintenance_run_items`を持つ運用修復用経路として意図を確認する。 |
| `shifts/googleSync.ts:126` `forceSyncBatch`、`shifts/crud.ts:300` `deleteShiftsDbOnly` | POSSIBLY_UNUSED | `shift.ts`から再exportされるが現行UI呼出しなし。現UIの修復は`repairGoogleCalendarSync`。 |
| `super-admin.ts:47` 削除stub | POSSIBLY_UNUSED | 顧客組織削除を拒否する保護用stub。未使用と保護意図を区別する。 |
| `report_corrections`と`correctionReason` | POSSIBLY_INCOMPLETE | DB/Actionの受け口あり、通常入力hookから理由を送らない。承認済み編集禁止・取消・再承認の設計との照合が必要。 |
| MFA、PWA/オフライン、GCSファイル正本化、物理purge | INTENTIONALLY_FUTURE | 承認済み方針で初期提供の対象外、または安全弁で停止。存在しないことだけで不要/削除対象にしない。 |

## 古い「現状」記述との差分

| 文書の説明 | 現行コードで確認したこと |
|---|---|
| 通常保存のversion競合検出は未実装 | `reports.ts:158`→`save_report_versioned`、foundation`:247`で競合検出、hook`:992`で競合メッセージ。訂正版UI・差分比較UIまで完成した意味ではない。 |
| backupは主に日次/月次CSV・HTMLのみ | `.github/workflows/full-backup.yml`と完全論理backup/restore/manifest/freshness scriptが存在。ただし成功世代や画像本体の保全証明は別。 |
| Google同期は `google_event_id IS NULL` が唯一の状態 | `google_sync_status`、error、synced_atを持ち、最新shift RPCがpending状態を更新する。 |
| 削除申請はreport限定UIがある（要確認） | 現行srcには削除申請ActionのUI呼出しを確認できない。提供記録一覧と記録編集は直接soft delete Action。 |
| パスワードの文字種条件は撤廃対象 | 現行 `passwordPolicy.test.ts:5`は8文字のみをassertし、旧説明から実装未対応とは判定しない。 |

20機能群すべてで要求された項目を記載した。未検証なのは本番設定・稼働実績、実際のRLS/REST/RPC/Storage拒否試験、外部サービス往復、復元成功、性能、画面を開いての操作結果である。これらをソース内の配線・テスト記述の有無から成功扱いしない。
