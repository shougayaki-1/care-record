# シフト管理画面の責務（Issue #131）

依存する #125・#129・#130 の統合後、`origin/main @ 3cdfdebbefafef6087c364e59e823f48baad0244` を基点に分割した。

| 所有者 | 責務・状態 |
| --- | --- |
| `src/app/app/shifts/manage/page.tsx` | workspace、権限判定、選択タブ・スタッフ・利用者・対象月、編集対象とモーダル開閉、各hookと表示部品の接続 |
| 同pageの `calendarRef` / 深リンクeffect | FullCalendar参照、`shiftId` / `start` の処理済み判定、カレンダー初期化・表示範囲取得。参照の生成・所有はpage一箇所 |
| `useShiftData` | マスタ・一覧・未同期件数の取得と取得状態、既存のフィルター・events変換。今回変更しない |
| `useSyncProgress` | 既存の同期・修復adapter。今回変更しない |
| `useShiftEditing` | シフト・ひな形の保存、取消・復元・削除、ドラッグ・リサイズ。編集失敗のrejectとカレンダーのrevert |
| `useShiftMonthOperations` | 月次preview、確認dialog、消去mode、生成・消去の処理中状態と消去進捗。通知・refresh・生成後のタブ切替・Google同期は明示callbackで接続 |
| `useShiftPdfExport` | PDF処理中状態、表示形式PDFとマトリックスPDFへのデータ受け渡し。生成・ダウンロードは既存`shiftPdfExport` / PDF componentを再利用 |
| `components/shifts/manage` | ひな形一覧、フィルターとaction slot、月次操作、2つの確認dialog、進捗表示。業務Actionを呼ばず、必要な値とcallbackだけを受け取る |

月次previewは読取だけで、閉じても生成しない。確定時だけ生成する。消去は既存の論理削除Actionを使い、組織・対象月（日本時間）・ひな形由来・未変更のみ／全件の条件と20件単位の処理を維持する。月次の消去進捗は編集・同期の進捗とは別に所有し、pageで表示へ接続する。

表示形式PDFはFullCalendarに描画されているeventsと表示形式・フィルター、マトリックスPDFは取得済みrawShiftsと表示月を使う。rawShiftsとeventsの二重状態整理は対象外とする。

認可、RLS、監査、Server Action、DB、migration、依存関係は変更しない。新しいStoryで検出した範囲に限り、対象月と進捗のラベル、確認dialog内の見出しの意味と文字コントラストを補った。

2026-10-23にcontext7でReact 19系のcustom hookと状態所有、Storybook 10系のplay・fn・portal内の検査を確認した。対象環境はReact 19.2.3、Next.js 16.3.6、Storybook 10.4.6。同梱のNext.js `use client`ガイドも確認した。
