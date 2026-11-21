# 監査 v2 切替証跡テンプレート（#151）

状態: **未記入・未実施**。環境ごと・切替ごとにコピーし、実施済みの項目だけ結果を記入する。
手順: [監査切替runbook](../audit-cutover-runbook.md)。空欄・未確認・失敗を成功へ読み替えない。
秘密値・イベント本文・個人識別子は記入せず、非公開証跡への参照とreceiptを使う。

## 対象と承認

| 項目 | 値 / 証跡 |
| --- | --- |
| 環境 / 切替ID | 未確認 |
| Supabase Project ref / PostgreSQL版 | 未確認 |
| Vercel Project / 配備SHA / URL | 未確認 |
| GCP Project / 10年bucket / 既存7年bucket | 未確認 |
| A/Bの統合SHA・migration名/digest・実適用履歴 | 未確認 |
| A/Bの配備version・dual読出し互換試験 | 未実施 |
| G migration名/digest / dry-run / 対象外差分なし | 未指定・未実施 |
| 完全backup receipt・完了/データ/確認時刻・14h判定 | 未確認 |
| retention/lock/IAM実設定と役割分離 | 未確認 |
| 実施窓 UTC / 許容lock待機秒 / statement timeout | 未承認 |
| 業務影響上限・中断条件・連絡先 | 未承認 |
| 適用承認者 / 時刻 / 承認範囲への参照 | 未承認 |
| Cron/secret/IAM/bucket等の別承認 | 未承認 |

## 試験と切替境界

| 項目 | ローカル | Staging | Production |
| --- | --- | --- | --- |
| 空DB/upgrade・既存v1全列不変 | 未実施 | 未実施 | 未適用 |
| security_hardening・関連DB/unit・型/lint/build | 未実施 | 未実施 | 未確認 |
| 2接続DDL待機・開始済みtransaction境界 | 未実施 | 未実施 | 未確認 |
| timeout全rollback・解除後再実行 | 未実施 | 未実施 | 未確認 |
| 旧/新アプリ互換・境界後v1追加なし | 未実施 | 未実施 | 未確認 |
| 異常分類・途中失敗・復元/再開拒否 | 未実施 | 未実施 | 未確認 |

各結果は実施時刻・SHA・DB/CLI版・run URL・制約を添える。Productionに合成の破壊試験を実行しない。

| 実操作 | 時刻 / run ID / 結果 / 非公開証跡 |
| --- | --- |
| 旧job scheduled/manual/APIの起動停止 | 未実施 |
| 全in-flight完了 / 応答不明objectの照合 | 未確認 |
| Bの保全継続方法と再開担当 | 未確認 |
| table lock取得 / 切替commit / migration履歴読戻し | 未実施 |
| 固定v1集合の取得境界・件数・digest | 未確定 |
| v2最初のscope/連番/headとv1追加なしの照合 | 未確認 |

## 全量照合と外部固定

| 項目 | 件数 / 結果 / 非公開証跡receipt |
| --- | --- |
| NULL hash/globalを含むv1全量・scope別inventory | 未実施 |
| 参照切れ / 分岐 / 複数GENESIS / 循環 | 未分類 |
| NULL / 再現不能 / 不一致・使用設定の根拠 | 未分類 |
| 旧export全object・全generation・schema別照合 | 未実施 |
| 未収録 / 重複 / 差異 / 当時未記録列 | 未確認 |
| Bの正式inventory manifest receipt | 未確認 |
| baseline object名 / generation / size / SHA-256 | 未発行 |
| control object名 / generation / size / SHA-256 | 未発行 |
| 前control参照 / 切替ID / v2開始条件 | 未確認 |
| generation指定読戻し・digest検証 / 検証ツール版 | 未実施 |
| DB外設定の固定先・変更履歴・読戻し | 未実施 |
| 未解決異常と提供判定への影響・判断者 | 未判定 |

初回baselineより前の無改ざんは遡及保証しない。既存異常の自動修復・合格化・新たなrisk受容はしない。
classificationの件数は重複し得るため、合計を全量件数の代わりに使わない。

## 有効化・復元・最終判定

| 項目 | 結果 / 証跡 |
| --- | --- |
| baseline全量照合・control固定後の有効化承認 | 未承認 |
| B新系列の有効化時刻・設定版 | 未実施 |
| 最初の完全receipt / ordinal / scope別head | 未確認 |
| backlog・最古未保存時刻・26h鮮度/未実行監視 | 未確認 |
| 復元DBと最新外部control/ordinal/head照合 | 未実施 |
| 同連番再採番・GENESISリセットの拒否 | 未実施 |
| 復旧不能時の欠落証跡・再開方法・別承認 | 未確認 |
| 中断時の保全方法・v2未保存範囲 | 未確認 |
| 未実施/失敗/未適用と次の担当 | 未確定 |
| 環境別移行完了の判定者・時刻 | 未判定 |

文書作成・PR作成・依存Issue closeだけで移行完了にしない。週次検証Cと準拠チェックの完了は別証跡を必要とする。
