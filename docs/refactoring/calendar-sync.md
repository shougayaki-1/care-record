# 設定・シフト管理の同期処理（Issue #130）

調査基点: `4901ea48a0896ebd6d0708c4ed64d937198d3231`。
実装前に2経路を比較し、以下の差を画面adapterの仕様として維持する。

| 項目 | 設定画面 | シフト管理 |
| --- | --- | --- |
| 未同期処理の接続確認 | statusのconnectedでは中断しない | connected=falseなら案内して終了 |
| 修復の接続確認 | 修復Actionの結果で判断 | statusで事前確認し、Action結果も判断 |
| 未接続の案内 | 「連携する」から接続 | 設定画面から接続 |
| 未同期0件 | info通知 | 通知なし、成功として返す |
| 未同期の進捗 | 1件単位、processed累計をtotalで上限化 | 同じ。モーダルに説明文も表示 |
| バッチ停止 | auth / remaining<=0 / succeeded=0 | 同じ |
| 集計 | succeeded / failed累計、最後のerrorKind保持 | 同じ |
| 結果通知 | errorKind優先、一部失敗はwarning、その他success | 同じ。再試行案内の末尾は「再同期してください」 |
| 未同期の終了処理 | 成功通知後、成功・例外・0件ともstatus更新（権限がある場合）。更新失敗はconsoleのみ。status更新の完了は待たずbusy解除 | バッチ開始後は例外でも件数更新。0件でも更新。未接続と事前確認例外では更新しない。更新成功後に結果通知 |
| 修復の進捗 | 0/1→1/1 | 同じ、モーダルに説明文も表示 |
| 修復の終了処理 | 結果通知後status更新 | 結果通知後件数更新 |
| カレンダー再取得 | なし | バナー/修復handlerが例外なく終了したら実行（未接続でも従来どおり実行） |
| 確認dialog / 例外案内 | 設定側adapterが保持 | シフト側adapterが保持 |

設定の未接続・0件挙動がシフトと異なる理由は既存コードからは確定できないため、統一しない。
`useCalendarSync` が進捗・実行寿命・Action呼出しの共通制御、
`calendarSyncRunner` が非Reactのバッチ反復・集計・結果通知判定、
`useSettingsCalendarSync` / `useSyncProgress` が各画面のadapterを担当する。

追加した停止規則は `processed=0` の場合の防御的停止のみ。
正常なAction応答では `succeeded=0` でも停止するため既存動作は変わらず、
矛盾した応答でも無限反復しない。auth以外のerrorKindだけを理由に追加の停止はしない。
組織IDは開始時に固定し、組織変更・unmountで処理の寿命を失効させる。
送信済みActionは取り消さず、その後のバッチ、通知、件数更新、カレンダー再取得を抑止する。
確認dialog待機も同じ寿命に属する。同一寿命での重複開始は拒否する。

OAuth・再認証復帰、token、Server Action、DB/RPC、修復アルゴリズム、認可・監査は変更しない。
画面の表示部品と通知文言も維持する。E2Eと実Googleへの接続試験は行わず、Action mockで検証する。

技術仕様確認: 2026-10-23、React 19.2.3。
context7のReact公式ドキュメントでuseEffect cleanupによる非同期応答の失効を確認。
Next.js 16.3.6は同梱の `node_modules/next/dist/docs/.../use-client.md` を確認。
