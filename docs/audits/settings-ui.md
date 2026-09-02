# Phase 0 設定画面・導線の静的棚卸し

対象: main `3cbae8813a872a100f6d980bab631b9ef5ea6a7c`、2026-09-02。コードを正本とし、`CLAUDE.md`、`.claude/rules/*`、`docs/system-decisions.md`、`ui-system.md`、`ui-exceptions.md`、`feature-overview.md`、`implementation-gap-plan.md`、`security-and-permissions.md`と照合した。原本の`AGENTS.md`は作業指針として読み、mainに存在する実装と混同していない。

ソース上で4タブ・8区画を確認した。項目数だけから「多すぎる」とは断定できない。問題の中心は、保存単位の混在、権限に応じないタブ、帳票/スタッフに分散した設定、保存後に古い状態へ戻る経路である。使用頻度は操作の性質からの推定であり、利用ログ・実測値ではない。画面実行・スクリーンショット・360px/200%/読み上げ試験は未実施。

証拠の略記: `settings/page.tsx` は `src/app/app/settings/page.tsx`、3つの `*Settings.tsx` は `src/components/settings/` 配下、`RoleManagementPanel.tsx` は `src/components/roles/RoleManagementPanel.tsx`、`AppLayout.tsx` は `src/components/layout/AppLayout.tsx`、`actions/*` は `src/app/actions/` 配下を指す。

## 現在の設定一覧

`management.*`は`RolePermissions.management`。画面の表示制御とサーバーの認可を区別した。通常更新はsession client/RLSまたはRPCで永続化され、下記の主要設定に「入力UIだけで保存先がない」ものは確認していない。

| 画面/カテゴリ/サブカテゴリ | 対象・権限 | 永続化・Action/RPC | 外部依存・危険度 | 使用頻度（推定）・重複/接続状態 |
|---|---|---|---|---|
| `/app/settings` → 基本設定 → 事業所名 | 組織。表示は設定画面到達者、編集は`organization` | `organizations.name`。`updateOrganizationName`→`update_organization_setting` | Drive連携時GASフォルダ更新も発生。中 | 開設/名称変更時の低頻度。UI/DB/GASは接続済みだが権限・部分成功にGAP-02 |
| 同 → 基本設定 → 交通費 | 組織。`organization` | `travel_cost_rate_yen_per_km`。`updateTravelCostSettings`→同RPC | 外部なし。今後の記録の算出に影響、中 | 制度変更時。事業所名とは独立保存だが同じ`saving`/`message`を共有 |
| 同 → Google連携 → Drive | 組織。UIは`integrations`、GAS作成/修復はowner | `google_folder_id`。`callGasApi(manage_org_folder)`→`updateOrganizationDriveFolder` | GAS/Google Drive。作成・修復・参照解除、中 | 初回/障害時。利用者別の帳票連携にも関連。解除確認あり、Drive本体は削除しないと説明 |
| 同 → Google連携 → Calendar | 組織。`integrations`、修復は`shifts.edit=all`も必要 | `getGoogleAuthUrlAction`、`getGoogleConnectionHealth`、`disconnectGoogleCalendar`、`getSyncStatus`、`syncUnsyncedBatch`、`repairGoogleCalendarSync` | OAuth/Google Calendar。解除・再認証・重複修復、高 | 初回/障害時。接続/未同期/進捗表示あり。認証・同期の正否は認証台帳へ集約 |
| 同 → 勤務・帳票ルール → 労働時間ルール | 組織。`organization` | `labor_premium_types`。`get/update/create/disableLaborPremiumType(s)`、作成は`create_labor_premium_type_atomic` | 外部なし。統計に使う率/閾値変更、中 | 制度変更時。名前・率・計算方法・深夜時間・日次/週次/変形労働時間を編集。作成/編集/即時切替が混在 |
| 同 → 勤務・帳票ルール → サービス種別 | 組織。`organization` | `service_types`。`get/create/update/deleteServiceType(s)`、作成は`create_service_type_atomic`、削除は`deleted_at` | 外部なし。シフト・実績の分類、中 | 初期/事業追加時。シフト区間の選択肢へ接続。名前編集、即時有効切替、確認付き論理削除 |
| 同 → 勤務・帳票ルール → スタッフ役割 | 組織。`organization` | `staff_roles`。`get/create/update/deleteStaffRole(s)`、作成は`create_staff_role_atomic`、削除は`deleted_at` | 外部なし。無給フラグが実績に影響、中 | 初期/雇用体系変更時。アカウント権限ロール・名簿役職プリセットとは別データ。役割名・無給・有効・削除 |
| 同 → 危険な設定 → 脱退/組織削除 | 脱退は本人所属。削除UIはownerかつ`organizationDelete` | `leaveOrganization`→`leave_organization_atomic`、`deleteOrganization`→`soft_delete_organization` | 削除は再認証。所属/利用可否が変わるため高 | 極低頻度。通常設定とタブで分離、削除は名称入力・再認証あり。物理削除機能ではない |

主要根拠: `src/app/app/settings/page.tsx:538`（4タブ）、`:549`/`:594`/`:756`/`:793`（各区画）、`:248`〜`:338`（基本/Drive保存）、`:488`〜`:523`（危険操作）。Actionは`src/app/actions/organization.ts:12`/`:23`/`:34`/`:78`/`:92`、`settingsSections.ts:12`、`laborPremium.ts:4`、`serviceTypes.ts:14`、`staffRoles.ts:15`。シフト選択への接続は`src/components/shifts/ShiftSegmentEditor.tsx:43`〜`:47`、労働ルール読取は`src/app/actions/statistics.ts:59`〜`:64`。

### 設定と隣接する画面

| 画面/カテゴリ | 権限・保存先・実行箇所 | 分散/重複の評価 |
|---|---|---|
| `/app/settings/roles` → ロール管理 | `roles`。`organization_roles`、`getOrgRolesFull/createOrgRole/updateOrgRole/deleteOrgRole`。`src/app/app/settings/roles/page.tsx:5`→`RoleManagementPanel` | 独立URLは存在するが、サイドバーの直接リンクはない。`/app/accounts`のロールタブも同じコンポーネントを使う。コード重複ではなく到達経路が二つ。UI-04 |
| `/app/accounts` → アカウント/ロール | `accounts`で画面、`roles`でロールタブ。招待・割当・無効化はaccounts Actions/RPC。`accounts/page.tsx:253`〜`:266`、`:419` | 人のアカウントと権限プリセットをまとめた主導線。`RoleManagementPanel`の再利用は妥当。rolesのみの権限では導線問題あり |
| `/app/profile` → 本人情報/認証 | 本人。氏名・avatarは`updateOwnProfile`/`uploadOwnAvatar`→profiles/Storage、パスワード/メール/identityはSupabase Auth、削除は`deleteUserAccount`。`profile/page.tsx:79`/`:105`/`:118`/`:135`/`:146` | アカウントメニューから到達。組織共通設定とは適切に分離。認証上の所見は別台帳 |
| `/app/clients/[id]` → 記録フォーム/担当スタッフ/帳票・連携 | `clients`。`saveClientForm`→`upsert_client_form_authorized`、`saveClientAssignments`→`replace_client_assignments_authorized`、`updateClientGoogleLink`、GAS。`clients/[id]/page.tsx:428`〜`:430`、`actions/clients.ts:107`/`:136`/`:171` | 「勤務・帳票ルール」タブには実際の記録フォーム/Googleテンプレートがなく、利用者詳細へ分散。対象単位は妥当だが発見用リンク/説明が不足 |
| `/app/staff` → 役職プリセット | `staffs`。名簿のpositionプリセット関連Actions。`staff/page.tsx:432`のダイアログ | ここでの「役職」、設定の「スタッフ役割」、権限の「ロール」は目的が異なる。DB統合対象と決めつけず、用語説明で区別すべき |
| `/app/backup`・`/app/logs` | バックアップ状況/監査閲覧は別の管理機能・権限 | 設定へ何でも統合すると運用操作と変更設定が混在する。現状の別画面を前提に、設定から必要な参照導線を検討 |

`organization.retention_years`、各マスタの並び順、`resetPresetRole`等はバックエンド値/補助Actionがあっても主要設定画面で編集するUIを確認できない。これだけで初期提供の欠陥とは判定しない。保持期間・物理削除・復元はsystem-decisionsの対象外/保留方針に従う。オーナー移管Action/UIの評価は認証台帳へ集約。

## UI所見一覧

| ID | 分類 | 要約 | 優先度 | 確度 |
|---|---|---|---|---|
| UI-01 | 失敗状態 | マスタ保存失敗のメッセージが開いたダイアログの背面に出る | P2 | Confirmed |
| UI-02 | アクセシビリティ | 設定の一部入力・有効スイッチ・ロール操作に関連付けラベルがない | P2 | Strong indication |
| UI-03 | 保存/読込の一貫性 | 基本情報取得エラーなし・空欄無反応・保存単位と結果の混在 | P2 | Confirmed |
| UI-04 | 権限/ナビゲーション | roles専任の到達経路、空タブ、owner限定と誤記する説明 | P2 | Confirmed |
| UI-05 | 共通UI | 設定ヘッダー/区画/ロール操作の共通部品利用が不統一 | P3 | Confirmed |
| UI-06 | 分類・状態復帰 | タブURL非対応、帳票設定の分散、即時保存と確定保存の混在 | P3 | Confirmed |

保存後タブ往復で旧データになる問題は**GAP-08**、Drive権限/部分成功は**GAP-02**に採番しており、UI所見として二重計上しない。

## UI-01 — マスタ編集失敗がダイアログ内に現れない

- **証拠・関数**: `ServiceTypeSettings.tsx:75`/`:90`、`StaffRoleSettings.tsx:78`/`:94`、`LaborPremiumSettings.tsx:138`/`:158`で`setError`する。Alertはそれぞれ`:115`/`:119`/`:181`のページ本体にあり、成功時しかダイアログを閉じない。ダイアログにerror/helperTextを渡していない。
- **影響**: 保存が完了しない理由を、現在操作中のフォーム内で把握できない。画面背面Alertの見え方・読み上げは実環境未確認。項目検証を項目横に、操作結果をtoastにする`docs/ui-system.md`とも不一致。
- **次の調査**: 文字数超過/DB失敗を再現し、ダイアログ内のエラー表示・フォーカス・読み上げ・再送可能性を確認する。

## UI-02 — 表示テキストと操作のアクセシブル名が未接続

- **証拠**: `settings/page.tsx:556`は独立したTypography、`:557`のAppTextFieldにlabel/id/aria-labelledbyなし。削除名称入力`:856`もplaceholderのみ。`ServiceTypeSettings.tsx:134`/`:160`、`StaffRoleSettings.tsx:142`/`:171`、`LaborPremiumSettings.tsx:212`のSwitchFieldはlabel/aria-labelなし。`RoleManagementPanel.tsx:153`/`:157`のIconButtonも同様。
- **共通部品の確認**: `src/components/ui/Fields.tsx:13`はTextFieldへpropsを渡すだけ。`SelectionFields.tsx:190`〜`:193`はlabelがなければSwitchをそのまま返す。呼出側のラベル不足を自動補完する実装はない。
- **影響**: スクリーンリーダー等でどの設定を操作しているか判断しにくい可能性。キーボード順序・コントラストを不合格とは断定していない。
- **次の調査**: DOMのaccessible nameと、360px/200%/キーボード/読み上げの実測確認。スイッチ名には対象行名と「有効」を組み合わせる設計を検討。

## UI-03 — 基本設定の保存・初期取得結果が明確でない

- **証拠・関数**: `settings/page.tsx:99` `fetchOrgDetails`はSupabaseの`data`のみを受け取り、error表示も読込完了フラグもない。`:63`/`:68`の空名称/20円の初期値をそのまま編集可能にする。`handleSave`（`:249`）は空白名なら何も表示せずreturnする。`:562`のボタンは空白でdisabledにしない。
- **結果の混在**: 事業所名保存と交通費保存は異なるActionだが共通`saving`（`:70`）・`message`（`:77`）。Alertはタブ共通`:547`に表示。交通費だけ3秒で結果を消す`:318`。基本名/交通費欄にdirty表示・未保存離脱ガードは検索で見つからない。変更中タブを変えても基本入力stateは保持されるが、外部遷移や再読込は別。
- **影響**: 未取得の既定値と取得済み値が区別できず、空入力の保存も無反応。別設定の保存結果が現在タブ上に見える。初期取得失敗直後の上書き可能性は専用環境で確認が必要。
- **次の調査**: 初期取得失敗・空名・空交通費（`Number('')`）・入力途中の離脱を確認し、項目検証と保存単位別状態を設計する。無操作タイムアウト等の認証仕様を変更する提案ではない。

## UI-04 — 権限別の到達・表示が揃わない

- **roles専任の導線**: `RoleManagementPanel.tsx:71`と`actions/roles.ts:31`/`:41`は`roles`権限を正しく使う。一方、`AppLayout.tsx:551`〜`:557`のsettings配下共通ガードはorganization/integrations/organizationDelete/ownerTransferのいずれかを要求し、rolesを含まない。`/app/settings/roles`にも適用される。主メニューのaccountsは`:486`でaccounts権限必須。`:51`のaccounts route保護もaccounts。
- **空タブ/説明**: `settings/page.tsx:538`の4タブは常に表示し、`:759`/`:770`/`:781`の内容はorganization権限で全て消す。そのためintegrationsだけの利用者は「勤務・帳票ルール」が空。`RoleManagementPanel.tsx:74`の拒否説明は「オーナーのみ」だが判定はroles権限である。
- **影響**: 担当権限を持つ人が専任画面へ到達できない、または対象がないのに空タブを開く。UIガードの過剰拒否であり、権限越えアクセスとは評価しない。
- **次の調査**: rolesのみ、integrationsのみ、ownerの権限セットでメニュー/直接URL/Action許可を比較する。空タブは非表示か権限説明を検討し、文言を権限ベースへ揃える。

## UI-05 — 共通UIの採用にばらつき

- **証拠**: `settings/page.tsx:533`〜`:537`は独自ヘッダー、各区画`:552`/`:572`/`:760`はBoxを個別構成する。`RoleManagementPanel.tsx:139`/`:176`/`:215`はButton、`:192`はTextField、`:149`はPaperで組み立てる。`ui-system.md`はInnerPageHeader/SectionCard/AppButton/AppTextFieldを優先。ロール色プリセットは`ui-exceptions.md`の明示例外なので色リテラルを欠陥としない。
- **影響**: 保存/取消/危険操作の視覚とloading/disabledの仕様を画面ごとに維持する必要がある。主設定がAppButton/AppDialog/NumberField等を採用し、モバイルStackも用意している点は肯定的。直接MUIのTabs/レイアウト/IconButtonは許容領域なのでそれ自体を違反に数えない。
- **次の調査**: 今後変更する区画で適合部品への置換範囲を確定。Phase 0で一括cleanupはしない。Storybookの該当状態との比較は次段階。

## UI-06 — 分類と操作結果の戻り先を整理する余地

- **証拠**: `settings/page.tsx:62`のタブstateは常に0から開始、`:538`はstateのみ更新。OAuth戻りの`:155`/`:158`/`:184`/`:192`はURLを`/app/settings`へ戻す。勤務・帳票ルール内は3マスタであり、実際の帳票テンプレート/記録フォームは`clients/[id]/page.tsx:428`〜`:430`。即時スイッチ変更は例`StaffRoleSettings.tsx:55`、モーダル保存は`:71`。
- **影響**: Google連携の戻りや再読込で基本設定へ戻る。URLで特定タブを共有できない。帳票項目を探す際に対象単位の違いが分かりづらく、「スタッフ役割/役職/ロール」の混同も起き得る。使用頻度・迷走率は未測定。
- **次の調査**: タブURL、戻り先、対象単位（本人/事業所/利用者/権限）の説明、即時保存表示を検討する。「項目が多い」だけを理由に階層を増やさない。

## 保存・読込・空表示・モバイルの総合評価

| 観点 | ソースで確認した実装 | 残る確認/課題 |
|---|---|---|
| 項目数 | 4タブに基本2、連携2、勤務3、危険1区画 | 過多の定量根拠なし。対象/保存方式の説明を優先 |
| 通常/危険操作の混在 | 危険操作は専用タブと確認ダイアログ | Drive解除・全同期修復も影響が大きいがGoogleタブ内。既存確認を維持し影響を説明 |
| 保存単位 | 名前・交通費は各保存、3マスタはダイアログ保存/即時有効切替、連携は即時操作 | GAP-02/GAP-08、UI-01/UI-03。全体一括保存への統合が必須とはしない |
| 読込 | workspace/Suspense spinner、3マスタは個別loading、接続health取得 | 基本情報の失敗/再試行なし。初期3マスタの一括取得失敗は個別fallbackあり |
| 成功 | 名前/交通費はAlert、Drive/危険操作/ロールはtoast、マスタは閉じて再取得 | transient結果をtoastへ揃える規約からばらつく。状態継続表示と分ける必要 |
| エラー/空 | マスタはAlertと「設定なし」。ロールは取得失敗toast | モーダル内失敗UI欠落。ロール0件はmap空で専用EmptyStateなし（`RoleManagementPanel.tsx:147`）。DB空と取得失敗は区別が必要 |
| モバイル | settingsのxs縦並び/全幅ボタン/横スクロールTabs、3マスタはsm未満カード表示 | 実画面の360px/200%は未検証。長い役割名、表/権限matrix、ダイアログの操作領域を確認 |
| 共通UI | AppButton/AppDialog/Fields等の採用あり、ロールpanelを再利用 | 独自ヘッダー/Box区画/旧Button・TextField、アクセシブル名を確認 |
| 二重送信 | 通常保存は`saving`でdisabled、マスタ保存も同様 | 有効切替とロール削除/脱退/組織削除の一部は専用pendingなし。重複結果は未検証、別の重大不具合としては採番しない |

## 検索と除外

`src/app/app/settings/**`、`src/components/settings/**`、`RoleManagementPanel`、`AppLayout`、`WorkspaceContext`、関連Actionsと現行migrationを読み、隣接するaccounts/profile/clients/staffへ逆引きした。`beforeunload|dirty|unsaved|未保存|変更を破棄`、tab/searchParams、Action/RPC名、`label|aria-label`、save/loading/error/emptyを検索。サービス種別/スタッフ役割のActionはシフト区間から呼ばれるため未使用ではない。3セクション一括取得Actionもページから呼ばれる。

設定内容が個別画面に分散していることと、コードが未接続であることは区別した。将来のMFA/オフライン/復元UI/物理削除は本監査から新規実装を要求しない。静的UI監査だけでコントラスト・操作時間・体感速度・実データの表示崩れを確定していない。
