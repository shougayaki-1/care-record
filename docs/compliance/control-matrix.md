# 準拠コントロールマトリクス

| ID | 要求 | 実装／証跡 | 状態 | 完了条件 |
|---|---|---|---|---|
| GOV-01 | 安全管理方針・責任者 | `operations-policy.md` | implemented | 代表者承認、年次レビュー記録 |
| GOV-02 | リスク評価 | `compliance_risks`、本表 | implemented | 全資産・脅威・残存リスクの承認 |
| IAM-01 | 一意な利用者識別 | Supabase Auth、組織ロール | implemented | 本番設定票と退職者失効試験 |
| IAM-02 | 二要素認証 | 明示的免除 | accepted-risk | 受容理由・代替策・承認者の記録 |
| IAM-03 | セッション制御 | `user_session_activity`、24時間idle、30日absolute、重要操作再認証 | pending | 複数端末・改ざん・失効・再認証E2E試験 |
| IAM-04 | 総当たり対策 | IP＋メール制限、段階遅延 | implemented | Supabase Auth側制限の設定証跡 |
| ACC-01 | テナント分離 | RLS、認可RPC | pending | 全テーブルRLS試験と本番カタログ出力 |
| ACC-02 | service role最小化 | 原子記録RPCへ移行 | pending | 通常操作からservice roleを全廃 |
| INT-01 | 記録真正性 | 完全スナップショット・版ハッシュ | implemented | 作成→訂正→承認→復元の再現試験 |
| INT-02 | 原子性 | `save_report_atomic`、`accept_invitation_atomic` | implemented | 強制失敗時に部分更新がないこと |
| LOG-01 | 重要操作監査 | `audit_events` | pending | 全操作一覧と成功・拒否・失敗テスト |
| LOG-02 | 改ざん検知 | SHA-256ハッシュチェーン | implemented | 定期チェーン検証結果 |
| LOG-03 | 外部保全 | `/api/cron/archive-audit` | implemented | WORM受信先、復元、重複排除証跡 |
| CRY-01 | 通信・保存暗号化 | TLS、Supabase/Vercel | pending | 保管国、暗号化方式、鍵管理のベンダー証跡 |
| CRY-02 | アプリ秘密情報 | versioned AES-256-GCM keyring | implemented | ローテーション演習と旧鍵失効記録 |
| FILE-01 | 初期提供の画像安全化 | 形式・シグネチャ・実デコード照合、WebP再エンコード | pending | 偽装・過大・件数超過の拒否とmetadata除去を確認。malware scanは提供開始後 |
| WEB-01 | ブラウザ防御 | nonce CSP、HSTS等 | implemented | 本番CSP違反ゼロ、ヘッダー試験 |
| BAK-01 | 独自バックアップ・復旧 | `backup-restore-bcp.md` | pending | 12時間完全バックアップと月次復旧試験で限定提供中RPO 14時間・RTO 4時間を実測 |
| BCM-01 | インシデント・BCP | 手順・記録テーブル | implemented | 年2回訓練と是正記録 |
| SUP-01 | 委託・再委託管理 | `vendor_registry` | pending | Supabase/Vercel/Googleの契約・国・exit plan承認 |
| RET-01 | 記録別保持 | `retention_policies`、legal hold | pending | 専門家確認済み根拠で暫定値を置換 |
| SDLC-01 | 脆弱性管理 | Security workflow、SBOM | implemented | High/Criticalゼロ、例外承認 |
| PRI-01 | 本人・利用者向け通知 | Privacy/Terms | pending | 法務レビュー、版管理、再同意試験 |
| SLA-01 | 開示書・SLA・責任分界 | `service-specification-sla.md` | pending | 顧客との明示合意と改定通知 |

## 実装上残るHigh項目

ブラウザからの医療情報テーブル直接SELECTとservice role利用がまだ残っています。対象画面をサーバーAPIへ順次移し、移行完了後に`authenticated`の医療情報テーブルSELECTをREVOKEします。途中でREVOKEすると業務画面が停止するため、これは段階移行とします。
