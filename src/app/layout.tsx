// app/layout.tsx
import type { Metadata, Viewport } from "next";
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '@/theme';
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import { TermsAgreementModal } from "@/components/auth/TermsAgreementModal";
import { ToastProvider } from "@/components/ui/ToastProvider";

const inter = Inter({ subsets: ["latin"] });
const poppins = Poppins({ weight: ['700'], subsets: ['latin'], variable: '--font-poppins' });

export const metadata: Metadata = {
  title: "CareRecord",
  description: "訪問介護記録サービス",
  manifest: "/manifest.json",
};

// AndroidにPC版と誤認させないための決定的な設定
export const viewport: Viewport = {
  themeColor: "#2255CC",
  width: "device-width",
  initialScale: 1.0,
  maximumScale: 1.0,
  userScalable: false, // ユーザーによるズームを禁止（アプリ化）
  viewportFit: 'cover',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <head>
        {/* 手動のmetaタグを追加して強制力を高める */}
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
      </head>
      <body className={`${inter.className} ${poppins.variable}`}>
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <ToastProvider>
              <TermsAgreementModal />
              {children}
            </ToastProvider>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}