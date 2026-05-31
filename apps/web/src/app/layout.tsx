import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/providers';
import { SwRegister } from '@/components/SwRegister';
import { InstallPrompt } from '@/components/InstallPrompt';
import './globals.css';

export const metadata: Metadata = {
  title: 'MoneyPulse',
  description: 'Privacy-first personal finance tracker',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MoneyPulse',
  },
  icons: {
    icon: '/favicon.svg',
    apple: '/icons/apple-touch-icon.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#7c3aed',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Providers>{children}</Providers>
        <SwRegister />
        <InstallPrompt />
      </body>
    </html>
  );
}
