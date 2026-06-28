import type { Metadata, Viewport } from "next";
import { AppRouterCacheProvider } from '@mui/material-nextjs/v15-appRouter';
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from '@/theme';
import { Poppins, Roboto } from "next/font/google";
import "./globals.css";
import { TermsAgreementModal } from "@/components/auth/TermsAgreementModal";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { ConfirmProvider } from "@/components/ui/ConfirmProvider";
import { WorkspaceProvider } from "@/context/WorkspaceContext";
import { ServiceWorkerCleanup } from "@/components/ServiceWorkerCleanup";
import { headers } from 'next/headers';

const roboto = Roboto({
  subsets: ["latin"],
  weight: ['300', '400', '500', '700'],
  display: 'swap',
});
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
  themeColor: "#1A73E8",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  minimumScale: 1,
  userScalable: false,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const nonce = (await headers()).get('x-nonce') || undefined;
  return (
    // suppressHydrationWarningを追加して拡張機能によるタグ書き換えエラーを抑制
    <html lang="ja" suppressHydrationWarning>
      <body
        className={`${roboto.className} ${poppins.variable}`}
        suppressHydrationWarning // <body>タグ自体に注入される属性エラーも抑止
      >
        <ServiceWorkerCleanup />
        <AppRouterCacheProvider options={{ nonce }}>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <ToastProvider>
              <ConfirmProvider>
                <WorkspaceProvider>
                  <TermsAgreementModal />
                  {children}
                </WorkspaceProvider>
              </ConfirmProvider>
            </ToastProvider>
          </ThemeProvider>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
