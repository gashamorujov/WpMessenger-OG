import './globals.css';
import config from '@/lib/config';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'WpMessenger OG',
  description: 'WpMessenger OG — WhatsApp Web Management Panel',
  icons: { icon: '/icon.svg' },
};

export const viewport = {
  themeColor: '#0b1220',
};

/**
 * Client-side runtime config, injected server-side (no build-time secrets).
 * The SPA reads window.__WPM_CONFIG__ for the realtime worker WS URL.
 */
function clientConfig() {
  return {
    apiUrl: '',
    wsUrl: config.workerWsUrl || '',
    version: config.version,
  };
}

export default function RootLayout({ children }) {
  return (
    <html lang="az" data-theme="dark">
      <head>
        <link rel="stylesheet" href="/spa.css" />
        <script dangerouslySetInnerHTML={{ __html: `window.__WPM_CONFIG__ = ${JSON.stringify(clientConfig())};` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
