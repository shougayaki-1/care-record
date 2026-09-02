# Performance Static Audit

対象: `main@3cbae8813a872a100f6d980bab631b9ef5ea6a7c`。調査日: 2026-09-02。

以下8件はすべて **Measurement candidate**。コードの構造は確認できても、「遅い」「不必要」「最適化すれば改善する」とは断定しない。Severity は計測の優先度、Confidence は性能影響の確度を示す。実行時間、bundle size、query plan、稼働件数、ネットワーク、実際の Supabase API 上限は未計測。

## PERF-01 — シフトのマスタ・画面データを再取得する契機

- Category: Measurement candidate / fetch waterfall・重複取得・state
- Summary: マスタは利用者→スタッフの順で取得。タブ変更を契機にマスタを取り直し、画面データも初期状態変更時に再取得する可能性がある。
- Evidence: `src/hooks/useShiftData.ts:139-181` の `fetchMasterData` は2 queryを逐次 await。`src/app/app/shifts/manage/page.tsx:146-161` の effect は `activeTab` と `initialLoading` を依存に含む。`useShiftData.ts:263-267` でイベント配列を生成し、同ファイルの後続 effect `:280-309` でも `rawShifts` から再生成する。
- Relevant files: 上記2ファイル、`src/utils/shiftHelper.ts` の `convertToCalendarEvents`。
- Severity: P2 Medium
- Confidence: Needs runtime verification
- Impact: タブ変更・初回表示・表示期間変更時のRTT、変換CPU、描画回数が増える候補。競合対策 `useRequestGeneration` は実装済みであり、古い応答を無条件に反映するとは判断しない。
- Recommended next investigation: 同一組織で初回表示→タブ3回切替→月移動をトレースし、clients/staffs/shifts/count別にrequest数・payload・React commit数を比較。利用者とスタッフqueryの独立性、認可前提を確認してから並列化可否を判断する。

## PERF-02 — 統計の明細取得量とクライアント集計

- Category: Measurement candidate / large props・serialization・pagination
- Summary: 月のシフトに帳票本文を複数の関連経路で含め、別queryでも帳票を取得し、クライアントで集計する。
- Evidence: `src/app/actions/statistics.ts:23-66` の `getStatisticsData` は `report_shifts.reports.report_values(data)` と `shift_segments.reports.report_values(data)` を含むシフト、および別の reports を取得する。`:74-80` では同じ配列を `shifts` と `shiftsWithLinks` に割り当てる。`src/app/app/statistics/page.tsx:121-168` で受信後 `aggregateByTab` / `buildShiftVarianceRows` を計算。これらのqueryにページングはない。
- Relevant files: 上記、`src/utils/statisticsAggregation.ts`、`src/app/actions/internalWork.ts`。
- Severity: P2 Medium
- Confidence: Needs runtime verification
- Impact: 明細の重複、転送量、ブラウザheapと集計CPUの増大候補。同一参照の実際のwire重複量はReact serializationの計測が必要。上限超過時の集計対象欠落も確認が必要。
- Recommended next investigation: 合成データで月間100/1,000/5,000明細と複数スタッフ・複数区間を比較。DB件数とUI集計を突合し、response bytes、long task、メモリ、計算時間、API上限を記録。4取得の `Promise.all` はすでに存在するため「全queryが逐次」とはしない。

## PERF-03 — 通常のシフト保存がGoogle APIを待つ

- Category: Measurement candidate / external critical path
- Summary: 通常の作成・更新・ドラッグ保存はDB更新後もGoogle API完了までAction応答を待つ。
- Evidence: `src/app/app/shifts/manage/page.tsx:173-185,216-231` → `src/app/actions/shifts/crud.ts:58-80,85-115,119-139`。`createShift` / `updateShift` の `awaitSync` 初期値は true。`src/app/actions/shifts/internal.ts:131-140` も同期をawait。`googleSyncInternal.ts:203-265` は更新/検索/重複削除/挿入/同期状態保存を行い、`:36-53` で一時障害・rate limitを再試行する。
- Relevant files: 上記、`src/utils/googleCalendar.ts`。
- Severity: P2 Medium
- Confidence: Needs runtime verification
- Impact: Google RTTや再試行が「保存完了」までの待ち時間になる候補。同期エラーでもDB保存を維持する仕様自体は実装されている。無条件の非同期化は実行終了後の処理保証を失うため、この監査で推奨しない。
- Recommended next investigation: DB commitまでとAction responseまでを別に計測。正常、429、503、token refreshをモックした試験でpending/failed表示と保存結果を確認する。将来分離する場合はdurable queueと監査・再試行・復旧仕様を先に決める。

## PERF-04 — 未同期ループの1件ごとに認可・count・OAuth client生成

- Category: Measurement candidate / repeated query・N+1候補
- Summary: サーバーはバッチを受け付けるが、現在のUIは進捗を1件ずつ更新するため limit=1 を渡している。
- Evidence: `src/hooks/useSyncProgress.ts:53-84` の `runUnsyncedSyncLoop` → `syncUnsyncedBatch(org, 1)`。`src/app/actions/shifts/googleSync.ts:70-107` は認可後さらに `getSyncStatus` を呼び、同ファイル`:36-61` で再認可、org読込、total/unsynced count。処理後にもremaining count。`googleSyncInternal.ts:151-170` は各対象でRPCによるcontext取得とrefresh tokenのみを設定した新規OAuth clientを生成する。
- Relevant files: 上記、`src/utils/supabase/auth.ts:76-82,141-155,250-287`。
- Severity: P2 Medium
- Confidence: Needs runtime verification
- Impact: 同期対象N件に対して認可とexact count、認証server・token endpointへの通信が繰り返される候補。アクセストークン取得回数はSDK挙動を含むため未確認。
- Recommended next investigation: 1/20/200対象の完了時間、request数、DB CPU、OAuth refresh回数を計測。組織認可を省略せず、バッチ内共有と進捗表示の両立を設計する。`docs/system-decisions.md:169` のGoogle同時1件方針は維持して比較し、無制限parallel化を解決策にしない。

## PERF-05 — 同期修復は全Googleイベント＋最大5,000シフトを単一Actionで処理

- Category: Measurement candidate / unbounded external enumeration・long action
- Summary: UIの「強制再同期」はcursor方式の `forceSyncBatch` ではなく、一括修復Actionを1回呼ぶ。
- Evidence: `src/hooks/useSyncProgress.ts:87-103` → `repairGoogleCalendarSync`。`src/app/actions/shifts/googleSync.ts:180-240` はlimit既定5,000、全active Google eventの列挙、シフト取得を行う。`googleSyncInternal.ts:80-96` の全件列挙は `nextPageToken` を最後まで辿る。`googleSync.ts:243-299` は各シフトを逐次更新し、保存event IDの検索に `allEvents.find` も使用する。
- Relevant files: 上記、`src/app/actions/shifts/types.ts`。
- Severity: P2 Medium
- Confidence: Needs runtime verification
- Impact: 長期間運用したCalendarの列挙量、O(シフト数×イベント数)の検索候補、Action時間制限、処理対象上限の影響。通常の未同期ループと修復は別の経路である。
- Recommended next investigation: イベント100/1,000/10,000件、シフト100/1,000/5,001件、削除済み/重複/古い形式を含む隔離Calendarで計測。API max_rowsによる実取得数と意図した5,000件を比較し、対象全件を処理できたかも確認。実際のホスティング制限値は別途取得する。

## PERF-06 — 検索用バックアップの全件列挙・選択ファイルの全文読込

- Category: Measurement candidate / pagination・large export・memory
- Summary: 検索用CSV/JSON生成はreportsを単一queryで取得し、一覧は組織prefix配下を列挙し、選択ファイルは全文をダウンロードして配列へ変換する。
- Evidence: `src/utils/gcs/export.ts:62-125,128-189` の `exportReportsAsCsv` / `exportReportsAsJson` はqueryをページングしない。`supabase/config.toml:18` はローカル `max_rows=1000`。`src/utils/gcs/upload.ts:84-95` の `listGCSFiles` / `readGCSFile` と `src/app/actions/backup.ts:71-135` は一覧・全文を処理する。
- Relevant files: 上記、`src/app/app/backup/page.tsx`、`src/app/api/cron/backup-daily/route.ts`、`scripts/backup/`。
- Severity: P2 Medium
- Confidence: Needs runtime verification
- Impact: 年数・世代数・件数増加で一覧payloadとheapが増える候補。API上限に達すると検索用出力が全件にならない可能性もある。これは検索用CSV/JSONの経路であり、別系統のDB完全論理バックアップが存在しない／欠落するという指摘ではない。
- Recommended next investigation: 合成1,001件以上でDB実件数・出力ID集合・画面件数を照合。リモートAPI上限とローカル値を混同しない。ファイルサイズ別にdownload/parse/renderを計測し、完全バックアップとの用途表示も確認。

## PERF-07 — 月次シフト展開の100並列RPCと一括タスク保持

- Category: Measurement candidate / database burst・long action
- Summary: 全patternの月内occurrenceをタスク配列化し、100件ずつ並列でRPCを実行する。
- Evidence: `src/app/actions/shifts/generation.ts:111-144,146-219` の `generateShiftsForMonth`。既存シフト一覧→pattern一覧は逐次。`CHUNK_SIZE=100` と `Promise.allSettled(chunk)` があり、Google同期は後続に分離されている。`src/app/actions/shifts/internal.ts:150-179` は1occurrenceにつき `save_generated_shift_atomic` RPC。
- Relevant files: 上記、同RPCを定義する現行migration、`src/app/app/shifts/manage/page.tsx:287`。
- Severity: P2 Medium
- Confidence: Needs runtime verification
- Impact: 展開件数に比例するDB requestと100件burst、Action時間・メモリ・競合の候補。「逐次処理だから遅い」とは逆の構造であり、単純なparallel化を勧めない。
- Recommended next investigation: 50スタッフ規模でpattern数とoccurrence数を変え、接続pool待ち、lock、RPC p95、部分失敗数と再実行結果を測る。既存queryの取得上限も確認し、同じ月の同時展開を別の整合性試験として扱う。

## PERF-08 — Workspace確定後に始まるClient画面取得と描画境界

- Category: Measurement candidate / hydration・fetch waterfall・large Client Component
- Summary: 多くの業務画面はWorkspace確定を待ってclient-side取得する。現行の遅延読込とSkeletonを踏まえ、残る待ち時間を測る必要がある。
- Evidence: `src/context/WorkspaceContext.tsx:49-102` は session→`ensureSessionActivityWithRetry`→membership/profile（ここは並列）。`src/app/app/statistics/page.tsx:143-168` はWorkspace待ち後取得と集計。`src/app/app/shifts/manage/page.tsx:46-62` はCalendarと2モーダルをdynamic import、`:146-161` はWorkspace待ち後取得。settings 898行、statistics 759行、shift manage 734行という規模はソース行数でありbundle sizeではない。
- Relevant files: 上記、`src/components/ui/PageSkeletons.tsx`、`src/app/app/reports/page.tsx`、`src/utils/shiftPdfExport.ts`、`next.config.ts`。
- Severity: P3 Low
- Confidence: Needs runtime verification
- Impact: ネットワークRTTとhydration後のeffectによる初期表示待ち候補。`ensureSessionActivity` はRLSの前提なので、取得を認証より前へ移す提案はしない。全ての `use client` を不要とは判定しない。
- Recommended next investigation: 冷cache/温cache・4G・低性能端末でworkspace-ready、data-ready、LCP、INP、React commit、download chunkを記録。`ANALYZE=true` の既存設定でbundle計測を別Issue化し、境界変更を先に実装しない。

## 誤検知を除外した点と追加query-plan調査

- FullCalendar は専用dynamic componentの中で読み込まれる。React PDFは `shiftPdfExport.ts:62-66,109-113,241-245`、`ReportsClientPage.tsx:281-299` で必要時import。ZIPも出力時にutilityをimportする。依存が大きそうという理由だけで初期bundleへの全量搭載と断定しない。
- `rg -n 'router.refresh|revalidatePath' src` は該当なし。過剰なrefresh/revalidateを現行findingにしない。
- `src/app/app/**/loading.tsx` に画面別Skeletonがあり、ReportsPageにはSuspenseがある。「Skeleton未実装」ではなく、Workspace待ち→effect fetch→dynamic chunkの各段階に適切なpendingが見えるかを確認する。
- Supabase関連取得の一部はすでに `Promise.all`。CLAUDE.mdはReact Compiler有効と記すが、`next.config.ts` に `reactCompiler` 指定がなく、追跡対象にBabel設定も見当たらない。`babel-plugin-react-compiler` 依存だけで有効と断定せず、build出力で確認する。手動memoの一括追加を推奨しない。
- index候補は **不足確定ではない**。現行init migrationに `idx_shifts_org_date` (`:2169`)、`reports_active_idx` (`:2237`)、`reports_active_date_range_idx` (`:2233`)、`shifts_active_google_sync_status_idx` (`:2285`)、`report_shifts_*`、`audit_events_org_created_idx` がある。月間範囲の両端条件・RLS subquery・未同期OR条件・exact countを、合成データの `EXPLAIN (ANALYZE, BUFFERS)` と実DB index catalogで比較する。`old/` のindex定義を適用済みとは扱わない。計測対象はPERF-02/04へ統合し重複findingを増やさない。

## Optimistic UI・Skeleton/Suspenseの分類

|分類|対象・現状|次の判断条件|
|---|---|---|
|Optimistic UIに適する|月/フィルタ/タブ/選択/折りたたみ。保存前のローカルフォーム編集|正本データの成功表示を伴わず、取消と古いrequestの無効化を保つ|
|条件付きで適する|スタッフ表示順、非重要マスタの表示ラベル、シフトドラッグ|認可・version/競合・rollback・監査・失敗通知が必要。現行ドラッグの `info.revert()` は存在するがDB error検出のGAPを先に調査|
|重要操作の成功を先取りしない|記録承認/訂正版確定、削除、owner移管、権限/ロール変更、再認証、外部資格情報変更、backup生成/復旧|サーバー/DB・監査・外部結果の確定後に成功を表示。pendingだけ先に表示してよい|
|Skeleton改善候補|Workspace待ち、各Client fetch、統計月変更、Calendar chunk|既存Skeleton/LinearProgressと競合せず、全画面のちらつきや二重spinnerを実端末で確認|
|Suspense改善候補|データ依存境界・出力componentの必要時読込|現在のeffect fetchはSuspenseを置くだけで待機対象にならない。Server Component移動は認証/cookie/RLS/no-storeの前提調査後|

## 計測の出口条件

`docs/system-decisions.md` の設計値（スタッフ50、利用者500、記録/シフト各10万、20同時セッション、通常操作p95 2秒、主要画面4Gで3秒、通常出力30秒）は目標であって達成値ではない。容量安全弁を優先し、隔離環境・合成データで収容件数を確認してから試験規模を決める。認証失効・権限・監査のfindingを先に解消/評価し、性能改善のために防御を除去しない。

Context7確認（2026-09-02）: `/supabase/ssr` のcookie/session refresh・getUser/getSession、`/supabase/supabase` のAPI `max_rows` と `range` pagination。対象依存のmanifest範囲は `@supabase/ssr ^0.8.0` / `@supabase/supabase-js ^2.91.0`、lockfile上の実版はそれぞれ **0.8.0 / 2.108.2**。最新docsの挙動とlockfileの版が一致するかは実測で照合する。[Supabase公式のpagination例](https://github.com/supabase/supabase/blob/master/apps/studio/components/interfaces/ProjectAPIDocs/ProjectAPIDocs.constants.ts)。
