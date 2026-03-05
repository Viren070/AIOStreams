import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Provider } from '@/components/provider';
import { Banner } from 'fumadocs-ui/components/banner';
import './global.css';

export const metadata: Metadata = {
  icons: {
    icon: '/favicon.png',
    apple: '/logo.png',
  },
};

const inter = Inter({
  subsets: ['latin'],
});

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Banner id="docs-wip">
          ⚠️ These docs are currently under construction and may not be fully
          accurate.
        </Banner>
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
