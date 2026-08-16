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
 * The SPA reads window.__WPM_CONFIG__ for the Firebase RTDB config and the
 * worker WebSocket URL (WS is the fallback realtime channel).
 */
function clientConfig() {
  return {
    apiUrl: '',
    wsUrl: config.workerWsUrl || '',
    version: config.version,
    firebase: config.firebase.enabled ? {
      apiKey: config.firebase.apiKey,
      authDomain: config.firebase.authDomain,
      databaseURL: config.firebase.databaseURL,
      projectId: config.firebase.projectId,
      storageBucket: config.firebase.storageBucket,
      messagingSenderId: config.firebase.messagingSenderId,
      appId: config.firebase.appId,
    } : null,
  };
}

export default function RootLayout({ children }) {
  return (
    <html lang="az" data-theme="dark">
      <head>
        <link rel="stylesheet" href="/spa.css" />
        <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js" defer />
        <script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-database-compat.js" defer />
        <script dangerouslySetInnerHTML={{ __html: `window.__WPM_CONFIG__ = ${JSON.stringify(clientConfig())};` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
