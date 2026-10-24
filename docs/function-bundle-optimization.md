# Functionバンドルの容量確認

2026-10-24、Next.js 16.3.6 / Node.js 24.12.0 / macOS arm64で測定した。
`googleapis` 171.4.0のルート入口は、未使用の生成APIもサーバーバンドルへ含めていた。
`src/lib/googleApis.ts` で利用中のCalendar、Cloud Logging、同じAuthPlus実装だけを読み込む。
依存バージョン、OAuth設定、トークン処理、認可、監査、デプロイ条件は変更しない。

## 測定方法と結果

同じlockfile、同じローカル専用環境設定で変更前後の `npm run build` を実行した。
各 `.next/server/**/*.nft.json` の `files` をmanifestの親ディレクトリから解決し、
実在するファイルのサイズを合計した。全体値は絶対パスで重複を除いた値。

| 対象 | 変更前（bytes） | 変更後（bytes） |
| --- | ---: | ---: |
| 全ルートのトレース対象ファイル・重複除外 | 44,439,800 | 32,740,927 |
| シフト管理pageのトレース | 39,240,956 | 27,565,550 |
| 設定pageのトレース | 34,877,886 | 23,202,481 |
| Google callbackのトレース | 2,271,719 | 2,248,342 |

全体は11,698,873 bytes（26.33%）減少した。変更前の最大サーバーチャンクは
11,977,791 bytes、変更後の最大チャンクは840,182 bytes。
ルートごとのトレースは共有ファイルを含むため、単純加算してFunction Storageとしない。
ローカル値にはmacOS用Sharp等が含まれ、Vercel上のLinux Functionサイズとも異なる。

検証ではProductionの資格情報を取得せず、APP_ENV=developmentとローカル専用の
Supabase URL/テスト用キーを使った。これはProduction設定の代用ではない。
build、typecheck、lint（警告0）、135ファイル・1,094件のunit testが成功した。
実クライアントのOAuth設定とCalendar / Logging生成もネットワークなしで検証した。

## リリース後の確認

1. 通常のDraft PR / Previewで、変更前後の同種Functionのsizeとregionsを比較する。
2. Previewでサインイン、Google OAuth、Calendar同期、権限付きCloud Logging表示を確認する。
3. 承認・CI確認後に通常の手順でマージする。現行Productionとロールバック先を保持する。
4. UsageのFunctions Storageを同じ期間で再測定する。古いFunction成果物はコード変更だけでは消えない。

この変更はGit連携・Ignored Build Step・保持ポリシー・既存デプロイを変更しない。
将来googleapisを更新する際は、この限定入口の互換性をtypecheck、unit test、buildで再確認する。

## 一次資料

2026-10-24にContext7 `/vercel/next.js` と `/websites/vercel` で
file tracing、serverExternalPackages、Ignored Build Step、git.deploymentEnabledを確認した。
併せてインストール済みNext.js 16.3.6の `node_modules/next/dist/docs/` と
googleapisの生成クライアント実装を確認した。

- [Next.js output tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Google公式クライアント](https://github.com/googleapis/google-api-nodejs-client)
- [Vercelの容量最適化](https://vercel.com/docs/deployment-storage/optimize)
