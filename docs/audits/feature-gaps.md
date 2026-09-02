# Phase 0 機能の接続・未完了箇所の静的監査

対象: main `3cbae8813a872a100f6d980bab631b9ef5ea6a7c`。基準日は2026-09-02。証拠のパスはこのSHAのリポジトリ相対パス。`work/main-snapshot`のコード・現行migrationを読み取り、コード・設定・schemaは変更していない。DB/API/Googleへの実行、E2E、性能計測は行っていない。`Confirmed`はソース上の制御経路の確認であり、本番発生の確認ではない。

`docs/system-decisions.md`を優先し、機能概要・gap-planの「現状」はコードと再照合した。認証・Google Calendarの監査は別台帳へ集約し、ここでは重複計上しない。P0=即時停止級、P1=重大な整合性障害、P2=通常業務への影響、P3=改善・提供範囲整理。

## 一覧

| ID | 分類 | 要約 | 優先度 | 確度 |
|---|---|---|---|---|
| GAP-01 | エラー無視・成功扱い | シフト時刻変更/取消がDB更新エラーを評価せず成功へ進む | P1 | Confirmed |
| GAP-02 | UI/Action権限・部分成功 | 事業所名・Drive操作のUI権限とGAS owner限定が不一致 | P2 | Confirmed |
| GAP-03 | 出力経路の欠落 | 統計CSVはブラウザ生成のみで出力監査・回数制御が未接続 | P2 | Confirmed |
| GAP-04 | 一覧の順序・継続表示 | 500件上限は案内済みだが、並べ替えは取得済み部分集合のみ | P3 | Confirmed |
| GAP-05 | バックエンドのみ | 記録削除申請/承認のActionとRPCに現行UIの呼出元がない | P2 | Confirmed |
| GAP-06 | 検証の重複・不一致 | マスタ作成RPCと更新Actionで名称・割増率検証が一致しない | P2 | Strong indication |
| GAP-07 | 読取エラーを空/旧データ扱い | 帳票の取得失敗がconsoleのみで、画面は空または旧結果のまま | P2 | Confirmed |
| GAP-08 | 保存後表示の接続不良 | 設定マスタの変更後、タブ往復で古い初期データに戻る | P2 | Confirmed |

## GAP-01 — シフト更新のPermission / RLS / 成功判定不整合

- **証拠・関数**: `src/app/actions/shifts/crud.ts:119` `updateShiftTimeOnly`、`:126`のupdate結果を未分解、`:139`で`success:true`。`toggleCancelShift`は`:144`、`:153`のupdate結果を未評価、`:166`で成功。UIは`src/app/app/shifts/manage/page.tsx:188` `handleToggleCancel`で成功toast、`:216` `handleEventChange`はthrow時のみ`info.revert()`する。
- **経路**: UI → permissions確認 → Supabase update → 同期 → 成功監査 → 成功表示。`permissions.ts` は `shifts.edit='assigned'` を許可する一方、DB UPDATE policy は `edit='all'` を要求する。PostgRESTのRLSによる0-row UPDATEは必ずしもerrorにならないため、Actionは更新結果を検証せず成功監査・成功responseへ進む。単に `if (error) throw` を追加するだけでは層間不整合を解消できない。
- **影響**: 利用者は「シフト時間を調整しました」「シフトをお休みに設定しました」と受け取る一方、DBは旧値のままとなり得る。成功audit eventも記録されるため、DB実態・UI・監査ログが不一致になる。P1は権限境界、業務シフト、監査整合性が同時に崩れるためである。
- **Issue scope**: Server Action、RLS、`permissions.ts`、成功audit、UI結果、regression testを1 Issueで扱う。片層だけの修正は完了条件を満たさない。
- **次の調査**: 専用環境でupdateが`{error:...}`を返す失敗試験を行い、同期/監査の呼出有無と画面revertを確認。影響行0件の扱いも別に確認する。

## GAP-02 — Drive連携がカスタム権限と接続されていない

- **証拠・関数**: `src/app/app/settings/page.tsx:527`〜`:529`の権限、`:560`で事業所名保存を公開、`:608`で`integrations`にDrive作成/修復を公開。`src/app/actions/gas.ts:120`〜`:123` `callGasApi`は`manage_org_folder`をownerだけに限定。`src/app/actions/organization.ts:12` `updateOrganizationName`は`organization`権限でDB更新可能。
- **部分成功**: `settings/page.tsx:248` `handleSave`はDB更新`:253`の後、**Drive連携済みの場合**（`:255`の`if (googleFolderId)`）だけGAS`:257`を実行する。この条件でカスタム権限のmemberはDB更新後にGAS認可で失敗し、`:271`で「更新失敗」。未連携なら名前のDB保存のみで成功する。一方、GASの外部通信失敗は`gas.ts:170`〜`:180`で`status:error`を返すが、名前保存側は戻り値を確認せず`:267`で「更新しました」とする。両方の矛盾した結果表示が存在する。
- **影響**: 権限があるように見えるDrive作成/修復が拒否される。Drive連携済みの名前保存は実際に保存済みでも失敗と見える、またはDrive更新失敗を成功と見せる。GASを呼ぶ場合、GAS未設定でも外部処理前に失敗する。
- **関連ファイル**: `src/utils/permissions.ts`、`supabase/migrations/20260716000015_org_deletion_rls.sql`（組織設定RPC）。Google Calendarの再認証要件とは別問題。
- **次の調査**: owner、organizationのみ、integrationsのみの3ケースで許可範囲を仕様確認し、DB成功/GAS拒否・GAS応答`status:error`のUI表示を専用環境で確認する。外部成功とDB成功の結果を分ける設計が必要。

## GAP-03 — 統計CSVの出力監査・回数制御がない

- **証拠・関数**: `src/app/app/statistics/page.tsx:253` `handleExportCSV`は`buildStatisticsCsv`→Blob→`link.click()`のみ。`:295`のボタンに接続される。`src/app/actions/statistics.ts:15` `getStatisticsData`は`reports`権限でデータを読むが、CSV操作時のActionではない。比較対象`src/app/actions/reports.ts:418` `auditReportExport`には出力監査があり、統計からの呼出はない。
- **要件との照合**: `docs/system-decisions.md` §10は出力種別・期間・件数・実行者・結果等の監査、§13はPDF/CSV/ZIP生成を毎分3回に限定。`src`・現行migrationのexport/rate/reserve検索では統計CSVの制御を発見できない。帳票側の監査Actionも、ここで回数制御実装済みとみなしていない。
- **影響**: スタッフ/利用者名を含む統計CSVの出力操作をサーバー側で追跡できない。ブラウザが既に受領したデータの複製を技術的に完全阻止するという意味ではなく、提供する出力ボタンの監査・制限が欠ける。
- **次の調査**: 統計CSVを出力操作台帳へ登録し、監査粒度と回数制限の対象を確定。専用環境で4回連続出力・監査失敗時の扱いを確認する。

## GAP-04 — 500件の部分集合だけを並べ替える一覧

- **証拠・関数**: `src/components/layout/AppLayout.tsx:469`で「全件表示」。`src/app/app/reports/ReportsClientPage.tsx:99` `fetchReports`は`:127`で`limit(500)`、`:131`で取得済み配列だけをsortする。対象クエリに`.order()`/`.range()`/総件数取得はない。`:483`〜`:485`には「最初の500件を表示しています。日付や利用者で絞り込んでください」という案内があり、上限非表示との初期仮説は棄却した。ページ送りはない。
- **影響**: 条件一致が501件以上なら絞込みが必要な設計。画面の並べ替えは全対象から最新500件を選ぶ処理ではなく、既に返った部分集合内の順序だけ変える。上限案内を考慮しP3の改善に留める。「全選択」は`:150`で表示配列のみ。実データの件数・DB実行順序は未確認。
- **次の調査**: 合成501件以上で並べ替えの境界を確認し、サーバー側の安定した順序を定める。ページング/総件数表示の必要性は絞込み運用と合わせて判断する。時間計測・クエリコストは性能台帳側へ分離する。

## GAP-05 — 削除承認ワークフローはバックエンドのみ

- **証拠・関数**: `src/app/actions/deletionRequests.ts:30` `requestReportDeletion`、`:53` `listDeletionRequests`、`:67` `approveDeletionRequest`、`:102` `rejectDeletionRequest`は実装済み。`supabase/migrations/20260716000015_org_deletion_rls.sql:17`の`request_report_deletion`、`:31`の`decide_report_deletion`は認可と更新を持つ。単なるstubではない。
- **逆引き結果**: 4Action名、2RPC名、`deletionRequests` import、`deletion_requests`を`src`全体で検索。生成型を除き呼出はActionファイル内のみ。画面/APIからの接続を発見できない。`src/app/app/reports/ReportsClientPage.tsx:531`の削除ボタンは直接削除経路。`docs/security-and-permissions.md`の「UI配線はreport限定」は現行コードと一致しない。
- **影響**: UIから申請→他者判断の運用ができず、バックエンド機能として残る。ただし`deletionRequests.ts:4`は直接削除に追加する経路と明記しているため、全削除に承認必須と決めつけない。初期提供で必要かは仕様の棚卸し事項。
- **次の調査**: 削除申請機能を初期提供するか確定し、採用する場合だけ申請・一覧・承認/却下導線、自己承認規則、監査の整合を確認する。

## GAP-06 — 作成・更新でマスタの入力検証が異なる

- **証拠・関数**: `src/app/actions/laborPremium.ts:16` `updateLaborPremiumType`は権限確認後patchをそのままupdate。UI `src/components/settings/LaborPremiumSettings.tsx:113`は`parseFloat`し`:135`へ渡す。入力`:301`の`min:0`は保存handlerの検証ではない。
- **DBとの照合**: 作成RPC `supabase/migrations/20260716000007_release_readiness_foundation.sql:462`は名前1〜100字・率0〜10を検証する。更新経路は同RPCを使わず、初期schema `supabase/migrations/20260630235959_init.sql:1342`のCHECKは計算法・時刻・期間enum等であり、負の率や名称長を規制しない。現行migration全体の対象列CHECK/更新trigger検索で同等検証は見つからない。`serviceTypes.ts:41`/`staffRoles.ts:47`の更新も名称patch直渡し、作成RPCのみ1〜100字を検証。
- **影響**: 作成で拒否される値を編集で保存できる可能性。割増率・労働時間閾値が集計入力になるため、単なる表示差分ではない。DBの実適用状態・負値での実出力は未確認なのでStrong indication。
- **次の調査**: 専用DBで負の率、空名称、101字、負の閾値をcreate/update双方に与え、保存・集計結果を確認する。許容範囲の正本を定め、DBとActionとUIを一致させる。法定率の判断は本監査の対象外。

## GAP-07 — 帳票取得失敗を利用者に知らせない

- **証拠・関数**: `src/app/app/reports/ReportsClientPage.tsx:99` `fetchReports`はerrorをthrowするが`:139`のcatchでconsole出力のみ。成功時だけ`:138`で結果を置換する。`:593`/`:652`は配列が空なら「該当する記録がありません」。
- **影響**: 初回取得失敗を0件と受け取る、またはフィルタ変更後の失敗で旧条件の記録が残る。Actionが未実装なのではなく、UIの失敗状態が未接続。フィルタ条件と表示内容の不一致は一括操作の判断を妨げる。
- **次の調査**: 初回と2回目の取得を別々に失敗させ、エラー/再試行/旧データ表示の明示と一括操作抑止を確認する。

## GAP-08 — 設定マスタを保存してもタブ往復で旧表示

- **証拠・関数**: `src/app/app/settings/page.tsx:138`の初期一括取得は`currentOrg`依存のみ。`:756`〜`:787`ではタブ2だけで3子をmountし、親の`settingsSectionsData`を`initial*`として渡す。親への変更通知callbackはない。
- **子側との照合**: `src/components/settings/ServiceTypeSettings.tsx:21`の`useState(initialServiceTypes)`、`:49`のeffectは初期propありなら再取得をskip。編集後`:72`〜`:74`、追加後`:86`〜`:89`は子だけ`load()`する。`StaffRoleSettings.tsx:21`/`:50`/`:75`、`LaborPremiumSettings.tsx:62`/`:89`/`:135`も同型。
- **再現手順の推定**: 初期取得完了→勤務・帳票ルール→マスタ編集/追加→別タブ→戻る。再mountした子は親に残る古い配列を採用し再取得しない。DB保存の失敗ではない。組織切替は`WorkspaceContext.tsx:222`〜`:227`で最終的に全遷移するため、別組織漏えいとは主張しない。
- **影響**: 保存した名称・有効フラグが戻り、新規種別が消えたように見える。再編集時に旧値を基に上書きする可能性。
- **次の調査**: 3セクションの追加/編集/有効切替それぞれでタブ往復を確認。親のキャッシュ更新か再取得の所有者を一つにする。UI台帳からこのIDを参照し二重計上しない。

## 意図的な将来機能・棄却した誤検出・保留候補

| 対象 | 判定と根拠 |
|---|---|
| MFA、PWA/offline、記録PDF/HEIC添付、GCS正本化、マルウェア検査 | `docs/system-decisions.md` §3/6/7で初期提供の除外・accepted-risk。未実装バグとして加点しない。 |
| アプリ内復元・super adminの顧客本文閲覧 | 同§4/9/11で提供しない機能。UIがないことを欠陥としない。 |
| 自動purgeのdry-run | 同§12の意図。no-op/ダミー成功と誤認しない。 |
| TODO/準備中/placeholder | `src`とworkflowのliteral検索では製品stubを発見できない。「準備中」は`ReportsClientPage.tsx:376`の進捗文言、placeholderは入力hint、dummyは環境値拒否の検証文字列。テストstub・Storybook fixtureは製品機能から除外。 |
| 設定一括取得のcatchがconsoleだけ | `settings/page.tsx:143`には表示なしだが、子はinitial未取得なら個別Actionへfallbackする。無条件に「読み込み不能」とはしない。親の基本情報取得失敗表示はUI台帳で扱う。 |
| masterのsort_order / resetPresetRole | `serviceTypes.ts:44`/`staffRoles.ts:50`は並び順patch可能、`roles.ts:110`はプリセット復元Actionあり。一方UIは追加順に表示し復元操作の呼出なし。提供要求が確認できず、バックエンド補助機能/未公開機能として記録し欠陥件数には含めない。 |
| AI一括下書きのスタッフ | `ai-import/page.tsx:403`は`_helpers`のみ、`reports.ts:172`はactualStaffs既定`[]`。`useRecordForm.ts:604`〜`:606`は旧形式の名称を復元、`:928`はIDとの件数不一致を拒否。再選択が必要か専用環境で確認が必要。`getMyReportHistory`は`:49`でdraftを意図的に除外するため「AI下書きが履歴に出ない」を欠陥としない。 |
| 検索用バックアップCSVの上限 | 完全DBバックアップと区別が必要。性能台帳のバックアップ項目へ集約し、この台帳では重複採番しない。 |
| 共通enumの繰り返し | laborの`additive/multiplicative`、`week/month`、削除statusはUI/Action/DBに重複。全enum重複を欠陥とはせず、実際のvalidation差だけGAP-06に採番。schema生成型が存在することも確認した。 |

## 検索範囲と限界

`rg --files`でsettings、actions、components、hooks、utilsを索引化し、`TODO|FIXME|HACK|XXX|not implemented|NotImplemented|coming soon|未実装|仮実装|ダミー|準備中`、`mock|stub|placeholder`、固定disabled・空onClick、Action/RPC名、`catch`/成功返却、保存/再取得、enum・CHECKを検索した。`supabase/migrations/old/`は歴史資料として結果に現れる場合があっても現行判定から除外し、主要結論は`!**/old/**`で再検索した。DB/RPCがあることだけでUI接続ありとは判定せず、UIのimport/handler/Action/DBを追跡した。

全エクスポートの到達性を機械的に証明したものではない。文字列生成による呼出、外部GASの実装、リモート設定・適用済みDB・実レコード数・ブラウザ実挙動は未検証。テスト/ビルド結果をこの文書の作成で更新していない。
