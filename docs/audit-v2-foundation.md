# 監査 v2 書込み基盤（Issue #149 / A）

設計正本: [監査チェーン設計 §3.1](audit-chain-verification-design.md)。本変更は準備schemaのみ。
既存イベント・hash・versionを変更せず、`integrity_version DEFAULT 1` と
`private.chain_audit_event()` の既存トリガーを維持する。アーカイブ・週次検証・本番切替は未実装。
準拠判定やrelease checklistの状態は変更しない。

## DB契約

- `audit_events.chain_scope` / `chain_sequence` / `chain_cutover_id` はnullable。
  v1行ではすべてNULL、v2では必須。scopeは`org:<UUID>`または`global`。
- `private.audit_chain_heads` はscopeごとに1行。切替ID、連番、hashを保持する。
  RLSを有効にし、PUBLIC / anon / authenticated / service_roleの全table権限を明示的に拒否する。
  新規関数のEXECUTEも同じロールから拒否し、公開RPCを追加しない。
- headは派生した内部状態であり、独立した業務操作・監査イベントとして記録しない。
  `permissions.ts` の`management.auditLogs`は従来の閲覧だけを表し、head管理を許可しない。
  既存の監査閲覧RLSと権限定義は変更せず、内部状態はどの業務ロールにも公開しない。
- `chain_audit_event_v2()` は未接続のBEFORE INSERTトリガー関数。
  G (#151) が承認された固定切替UUIDを唯一の引数として接続する。
  この準備migration自体に切替UUIDやv2有効化フラグは置かない。
  将来の切替では設計§3.2に従いtable lock・default・トリガーを原子的に変更する。
- 呼出し元のversion=2を検査し、連番・scope・切替ID・前hash・hashの持込みとv1へのdowngradeを拒否する。
  head作成の競合を直列化し、行ロック取得後のheadから採番する。`nextval()`は使わない。
  イベントとheadのrollbackにより番号を再利用する。
- 各head採番更新の遅延constraint triggerが、その更新時点の連番・hash・前hash・canonical hashに
  対応するイベントを検査する。最終headだけの照合にはしない。
  初期headの連番0も、GENESISを前hashとするイベント1がなければcommitを拒否する。
  イベント側の遅延constraintはheadによる採番とcanonical hashを検査し、準備段階のv1経路からのv2偽装も拒否する。
- 同一scopeの`(chain_scope, chain_sequence)`は切替IDにかかわらず一意。
  別の切替IDによる既存scopeの再初期化を拒否する。復元・切替はGの外部基準との照合が必要。

## canonical bytes（PostgreSQL 17）

DB関数が返すbyteaを正本とし、JavaScriptで再serializeしない。
`audit_canonical_v1`は保存済みprevious_hashを使う従来のconcat_ws式で、当時のTimeZone/DateStyleに依存する。
過去の異常の修復や順序の再解釈には使わない。

`audit_canonical_v2`は固定順の`jsonb_build_array(...)::text`をUTF-8化する。
配列の順序はversion、切替ID、scope、連番、id、event_id、organization_id、actor_id、action_type、
resource_type、resource_id、outcome、request_id、session_id、reason、created_at、details、ip_hash、
user_agent、previous_hash。versionはJSON数値、**連番は10進文字列**、UUIDは小文字文字列。
日時はUTCの`YYYY-MM-DDTHH:mm:ss.ffffffZ`（小数秒6桁）。NULLはJSON null、空文字は空文字として区別する。
JSONBの空白・キー順・数値表現もbytes契約に含むため、DBメジャー更新時は固定fixtureを再検証する。
先頭のprevious_hashは`GENESIS:v2:<切替UUID>:<scope>`。SHA-256を小文字hexにしてevent_hashへ格納する。

`database.generated.ts`のbigintはCLI仕様でnumberになるが、監査転送・検証でその値を直接扱わない。
後続B/CのRPCでは設計通り10進文字列と可逆なcanonical bytesを返し、Number/Dateで精度を失わせない。

## 分離レベルと再試行

Read Committedでは同一scopeのロック待機後に最新headを使う。
Repeatable Read / Serializableの`40001`、複数scopeの取得順が交差した`40P01`はそのまま返し、
トランザクション全体をrollbackする。複数scopeをあらかじめ列挙できる呼出し元は一定順で取得する。
トリガー内で部分再試行はしない。業務RPCの再送は既存の冪等性契約で行い、
既に行った外部送信などを無条件に再実行しない。本Issueは業務RPCのretryを変更しない。

## 検証方法

共有・開発DBを使わず、CLI 2.108.0 / PostgreSQL 17の使い捨てstackを用意する。
既存の[DB CI](../.github/workflows/ci.yml)は空DB再構築、型生成、全pgTAP、DB lintの後に、
既存のowner/内勤試験、最後に次の監査試験を実行し、stackを破棄する。

```sh
node scripts/db/test-audit-v2-concurrency.mjs supabase_db_care-record-owner-add-test-<run-id>
```

専用の`supabase_db_care-record-audit-v2-test-<id>`も許可する。通常の`supabase_db_care-record`等は
Dockerを呼ぶ前に拒否する。並行試験は当該stack内でのみv2トリガー/defaultを有効化してcommitするので、
**最後に実行し、そのstackを必ず破棄する**。本番切替migrationではない。

- `audit_v2_foundation.test.sql`: 準備schemaで旧INSERTがv1となること、ACL/RLS、v2偽装拒否、
  global/組織、複数行・同時刻・逆UUID、DO NOTHING/後続trigger skip、持込み拒否。
  固定bytes fixtureはUnicode・改行・NULL/空文字・2^53超・マイクロ秒を含み、別TimeZone/DateStyleでも一致する。
  fixtureのv2有効化を含む全変更はROLLBACKする。
- 実接続試験: pg_stat_activityのLock待機を確認し、新規scope同時生成、rollback、scope間の逆commit、同一scopeで開始順と逆のcommit（古い日時が連番2）、
  実際の40001（RRとSerializable）と40P01、全transaction再試行、実COMMIT時のスキップ拒否を検証する。
  commit済みの全scopeで連続性・件数・hash・前hash・headを検算する。
- upgrade fixture: 旧schemaで合成記録と監査の全既存列をcommitし、差分migration後も各行が不変であることを比較する。
  新設列だけは比較対象から除外し、既存列の削除・変更を拒否する。

Context7確認: 2026-10-24、PostgreSQL 17公式ドキュメント。
確認対象は遅延constraint trigger、ON CONFLICTとBEFORE trigger、Read Committedの可視性、40001/40P01時の再試行契約。

## ローカル実行結果（2026-10-24）

PostgreSQL 17.6 / Supabase CLI 2.108.0の専用stackで空DB再構築と旧schemaからのupgradeを実行。
両環境で全pgTAP 509件が成功し、全既存監査列のupgrade前後比較、DB lint、public生成型の一致、
実2接続・実COMMIT試験も成功。使い捨てstackは試験後に破棄した。
lockfileどおりの依存でunit 1,112件、CI分類/guard 32件、typecheck、警告0のlint、production buildが成功。
E2E・本番/共有DBへの適用・v2有効化・外部保管設定の変更は未実施。
