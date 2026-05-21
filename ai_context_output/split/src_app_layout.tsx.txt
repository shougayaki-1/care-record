import type { Metadata, Viewport } from "next";
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '@/theme';
import { Inter, Poppins } from "next/font/google";
import "./globals.css";
import { TermsAgreementModal } from "@/components/auth/TermsAgreementModal";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { WorkspaceProvider } from "@/context/WorkspaceContext";

const inter = Inter({ subsets: ["latin"] });
const poppins = Poppins({
  weight: ['700'],
  subsets: ['latin'],
  variable: '--font-poppins'
});

export const metadata: Metadata = {
  title: "CareRecord",
  description: "訪問介護記録サービス",
};

export const viewport: Viewport = {
  themeColor: "#2255CC",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarningを追加して拡張機能によるタグ書き換えエラーを抑制
    <html lang="ja" suppressHydrationWarning>
      <body
        className={`${inter.className} ${poppins.variable}`}
        suppressHydrationWarning // <body>タグ自体に注入される属性エラーも抑止
      >
        <AppRouterCacheProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <ToastProvider>
              <WorkspaceProvider>
                <TermsAgreementModal />
                {children}
              </WorkspaceProvider>
            </ToastProvider>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}