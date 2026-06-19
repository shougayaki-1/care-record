import type { NextConfig } from "next";

// PWAプラグインの読み込み
// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require('next-pwa')({
  dest: 'public', // サービスワーカーの出力先
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development', // 開発中はキャッシュさせない（重要）
  runtimeCaching: [
    {
      urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/app') || url.pathname.startsWith('/super-admin'),
      handler: 'NetworkOnly',
      method: 'GET',
    },
    {
      urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/api'),
      handler: 'NetworkOnly',
      method: 'GET',
    },
  ],
});

// Content-Security-Policy（多層防御）。
// MUI/emotion はインラインスタイルを使うため style-src に 'unsafe-inline' が必要。
// Supabase / Google API への通信、画像(署名URL・data/blob)、PWA を許可する。
// まずは Report-Only で導入し、違反レポートを確認してから強制(Content-Security-Policy)へ移行する。
const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co https://*.googleusercontent.com https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://www.googleapis.com https://accounts.google.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // Report-Only: 既存画面を壊さないか確認後、'Content-Security-Policy' へ切替える。
  { key: 'Content-Security-Policy-Report-Only', value: cspDirectives },
  ...(process.env.NODE_ENV === 'production'
    ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]
    : []),
];

const nextConfig: NextConfig = {
  // 型付きルーティングを無効化してエラーを回避
  typedRoutes: false,
  // PDFライブラリのための設定 (既存)
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
  async headers() {
    return [
      { source: '/(.*)', headers: securityHeaders },
      {
        source: '/app/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
      {
        source: '/super-admin/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'private, no-store, max-age=0' }],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
        ],
      },
    ];
  },
};

// PWA設定でラップしてエクスポート
export default withPWA(nextConfig);
