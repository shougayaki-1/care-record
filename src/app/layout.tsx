import type { Metadata, Viewport } from "next";
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '@/theme';
import { Inter, Poppins } from "next/font/google"; // Poppinsを追加
import "./globals.css";
import { TermsAgreementModal } from "@/components/auth/TermsAgreementModal";

const inter = Inter({ subsets: ["latin"] });
// タイトル用フォント設定 (太字700)
const poppins = Poppins({
  weight: ['700'],
  subsets: ['latin'],
  variable: '--font-poppins'
});

export const metadata: Metadata = {
  title: "CareRecord",
  description: "訪問介護記録サービス",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "CareRecord",
  },
};

export const viewport: Viewport = {
  themeColor: "#2255CC",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      {/* bodyにフォント変数を適用 */}
      <body className={`${inter.className} ${poppins.variable}`}>
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            {/* 規約同意モーダル (全ページ共通) */}
            <TermsAgreementModal />
            {children}
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}