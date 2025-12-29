import type { NextConfig } from "next";

// PWAプラグインの読み込み
const withPWA = require('next-pwa')({
  dest: 'public', // サービスワーカーの出力先
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development', // 開発中はキャッシュさせない（重要）
});

const nextConfig: NextConfig = {
  // PDFライブラリのための設定 (既存)
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

// PWA設定でラップしてエクスポート
export default withPWA(nextConfig);