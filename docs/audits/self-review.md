# Phase 0 自己レビュー・検証記録

対象 `main@3cbae8813a872a100f6d980bab631b9ef5ea6a7c`、2026-09-02。成果物はAudit文書7ファイルとIssue草案5件。アプリの修正は実施していない。

## 別のレビュー視点

調査担当の主張をそのまま採用せず、統合担当が認証の期限更新、RPC定義/GRANT、一括削除の停止条件、DBエラー無視、設定の親子state、共通画面ガードをソースへ戻って確認した。さらに認証担当が自分の担当外のGAP-01/02/08とPERF-03/04/05/06を読み、条件の省略、根拠不足、古い文書依存、severity、同根重複を照合した。これは実環境試験を代替するものではない。

|要求された観点|確認・修正した内容|
|---|---|
|1. 推測をConfirmedとしていないか|Confirmedをコード分岐/定義の存在に限定。AUTH-03/08、GAP-06、UI-02はStrong indication。性能8件は全てNeeds runtime verification。本番への影響発生は未確認と明記|
|2. 古いdocsを現在実装として扱っていないか|main SHA固定、old migrationを適用対象から除外。version付き保存、完全論理backup、同期status列、遅延import、8文字passwordは現行コードを確認。React Compilerは依存の存在だけで有効とせず、記述を訂正|
|3. UIだけでBackend未実装と断定していないか|削除申請・owner移管・訂正理由・保守ActionのRPCまで追跡。Backendが存在することとUI導線がないことを分けて記録|
|4. Backendだけでunusedと断定していないか|Action名、import、RPC名をsrcで逆引き。再exportだけの経路はPOSSIBLY_UNUSEDとし、外部利用や運用用途の可能性を残した。REMOVE判定なし|
|5. security severityは妥当か|P0なし。P1はGAP-01/AUTH-01/AUTH-02の3件に限定。AUTH-04はchunk内最大19件でrepair経路と手動復旧があるためP2へ変更。AUDIT-01は認可回避ではなく重要操作の証跡欠落としてP2。通常権限が必要なRPCを無認証侵入とせず、DB・JWT設定次第の部分を明記。accepted-riskのMFA/長期sessionそのものを新規脆弱性扱いしない|
|6. 重複IDはないか|同期の失敗分類/途中削除はAUTH、純粋な待ち時間はPERF。設定旧表示はGAP-08、Drive部分成功はGAP-02へ集約しUIでは参照。バックアップ上限はPERF-06へ集約。feature-inventoryの観察・ライフサイクル理由はfinding数へ重ねて加算しない|
|7. 具体的Evidenceがあるか|各台帳でrepo相対path・関数・行番号を記載。RPCは後続定義/GRANTも照合。パス存在・行番号範囲を機械検査。省略されたファイル名は近接のRoute/Component文脈を参照|
|8. runtime確認が必要な項目を明示したか|認証20ケースの未実施マトリクス、性能8候補、360px/200%/読み上げ、件数境界、外部連携、実適用DB/運用証跡を明記。テストファイルの存在をpassingと書いていない|

## レビューで実際に訂正・棄却した項目

- **GAP-04**: 当初の「500件打切り警告なし」は誤り。`ReportsClientPage.tsx:483-485` のAlertを確認し訂正。残る部分集合の並べ替え・次ページ導線に限定して **P3** とした。
- **GAP-02**: 事業所名保存後のGAS呼出は `settings/page.tsx:255` の `if (googleFolderId)` 内。**Drive連携済みの場合**の部分成功として限定。未連携のmemberも必ず失敗するとは記載しない。
- **GAP-08**: 組織切替による漏えいという仮説は採用しない。`WorkspaceContext` のhard navigationを確認し、同一組織内のタブ再mountと旧initial propsに対象を限定。
- **AI下書きの履歴非表示**: draft除外は意図的で、旧 `_helpers` の復元処理もある。正式staff関連への反映は未採番の次回検証候補とし、欠落確定としない。
- **PERF-06**: 「全ファイル読込」を「全件列挙・選択ファイルの全文読込」へ修正。全バックアップ本文を一度に取得すると誤読させない。検索用exportと完全DBbackupを分離した。
- **React Compiler・行数**: docsの「有効」をそのまま採用せず、設定不明として修正。shift manageの行数を実測 **734行** に訂正。行数をbundle量として扱わない。
- **依存版**: manifestの許容範囲とlock版を分けた。Supabase JSは `^2.91.0` の記述に対してlockは **2.108.2**。

## 実行した検証と結果

|検証|結果・限界|
|---|---|
|開始時branch/status/log5、AGENTS読取|mainは68 commits behind、未追跡AGENTSのみ。ローカルmainを調査本体にしなかった|
|`git ls-remote origin refs/heads/main`|GitHub mainと既存origin/mainが対象SHAで一致。初回sandbox内ではDNS拒否、承認された読取で確認|
|固定SHAの `git archive` と調査用コピーのbyte比較|**721ファイル一致、変更0**。調査担当がアプリ・設定・migrationを変更していないことを確認|
|`git diff --exit-code`（既存checkout）|既存追跡ファイルの差分なし。未追跡AGENTSは保持|
|Audit内のpath/行番号・ID/Severity集計|明示されたrepo path付き行参照の存在/範囲、重複IDなし、33件のseverity合計（P0 0 / P1 3 / P2 26 / P3 4）、20機能の主分類、文書間リンクを検査。略記の参照は該当文脈でソース再読|
|Audit文書の `git diff --no-index --check`|7ファイルすべてwhitespace診断なし。新規ファイルのためdiff自体のexit 1を差分ありとして扱い、診断出力が空であることを確認|
|`npm run typecheck`|**実行不能: exit 127、`tsc: command not found`**。調査用コピーにnode_modulesなし|
|`npm run lint -- --max-warnings=0`|**実行不能: exit 127、`eslint: command not found`**。依存導入は行っていない|
|unit/UI/build/E2E/DB試験|**未実行**。E2Eは専用環境・承認が必要。型/lintも成功とは報告しない|
|性能・OAuth実接続・本番DB・GCS・復旧演習|**未実施**。レポートは静的事実と次回の検証計画のみ|

文書の変更範囲は `docs/audits/{overview,feature-inventory,authentication,performance,feature-gaps,settings-ui,self-review}.md` の7件のみ。元の未追跡AGENTS、既存branch、既存アプリコードを保持する。commit、push、PR作成、GitHub Issue作成は今回の成果に含めない。

## 調査の限界

コードベース全体を検索したが、完全dependency graph、全認可直積、全query plan、全外部サービス設定の証明はしていない。特にAuth providerの失効タイミング、リモートmigration適用、実際のテナント件数/上限、外部GAS実装、Google token/鍵ローテーション、backupの画像本体・復元結果、法令適合は別の証跡が必要。これらの未確認を理由に既存実装をその場で変更していない。
