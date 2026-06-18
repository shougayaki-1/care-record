import type { NextConfig } from "next";

// PWAプラグインの読み込み
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require('next-pwa')({
  dest: 'public', // サービスワーカーの出力先
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development', // 開発中はキャッシュさせない（重要）
});

const nextConfig: NextConfig = {
  // 型付きルーティングを無効化してエラーを回避
  typedRoutes: false,
  // PDFライブラリのための設定 (既存)
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

// PWA設定でラップしてエクスポート
export default withPWA(nextConfig);
