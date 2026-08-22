import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Provider } from '@/components/provider';
import { SITE_URL, sharedOpenGraph } from '@/lib/site';
import Script from 'next/script';
import './global.css';

const DESCRIPTION =
  'A single Stremio super-addon: your addons, debrid and usenet services, built-in indexers and a native usenet engine, all deduplicated, filtered and sorted.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    template: '%s | AIOStreams',
    default: 'AIOStreams',
  },
  description: DESCRIPTION,
  openGraph: {
    ...sharedOpenGraph,
    type: 'website',
    url: SITE_URL,
    title: {
      template: '%s | AIOStreams',
      default: 'AIOStreams',
    },
    description: DESCRIPTION,
  },
};

const inter = Inter({
  subsets: ['latin'],
});

export default function Layout({ children }: LayoutProps<'/'>) {
  const isProd = process.env.NODE_ENV === 'production';
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        {isProd && (
          <>
            <Script
              src="https://plausible.viren070.me/js/pa-TiGGPZ3sO-A7zouJWYXD9.js"
              strategy="afterInteractive"
            />
            <Script id="plausible-init" strategy="afterInteractive">{`
              window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)};
              plausible.init=plausible.init||function(i){plausible.o=i||{}};
              plausible.init();
            `}</Script>
          </>
        )}
        <Provider>{children}</Provider>
      </body>
    </html>
  );
}
