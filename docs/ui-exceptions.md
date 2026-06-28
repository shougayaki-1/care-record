# UI統一の許容例外

次の領域は外部仕様または描画エンジン固有のため、共通UIコンポーネントではなく共有トークン相当の定数だけを利用します。

- `src/components/pdf`: React PDF固有のStyleSheetと印刷色。
- `src/components/shifts/ShiftCalendarViewer.tsx`と`src/utils/shiftHelper.ts`: FullCalendarへ渡すCSS変数・イベント色。
- OAuthのGoogle・Microsoftロゴ: 各ブランド公式色。
- `src/app/layout.tsx`のmetadata themeColor: HTMLメタデータへ渡す静的ブランド色。
- 画像アップロード用の非表示native input。
- `src/components/manual`: 操作説明用の赤い注釈、疑似スクリーンショット、手順強調のための装飾色。ただし、実アプリ画面に戻す共通UIは`docs/ui-system.md`のルールに従います。
- ロール色プリセット: 利用者が選ぶ分類色として、テーマカラーではなくプリセット値を保持します。

画面固有のDialog、Button、Field、Tableを新規追加する場合は、`src/components/ui`のセマンティックコンポーネントを優先します。
