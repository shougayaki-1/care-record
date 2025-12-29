import type { Metadata, Viewport } from "next"; // Viewportを追加
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '@/theme';
import { Inter } from "next/font/google";
import "./globals.css";
import { TermsAgreementModal } from "@/components/auth/TermsAgreementModal";

const inter = Inter({ subsets: ["latin"] });

// PWA用のメタデータ設定
export const metadata: Metadata = {
  title: "CareRecord SaaS",
  description: "介護記録サービス",
  manifest: "/manifest.json", // マニフェストへのリンク
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CareRecord",
  },
};

// ビューポート設定（テーマカラーなど）
export const viewport: Viewport = {
  themeColor: "#2255CC",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1, // アプリっぽくするためにズームを抑制
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className={inter.className}>
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <TermsAgreementModal />
            {children}
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}