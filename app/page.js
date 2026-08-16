'use client';

import Script from 'next/script';

/**
 * Panel shell — the interactive UI is a client-side SPA (public/spa.js)
 * that talks exclusively to the Next.js Route Handler API. This keeps the
 * App Router as the single server entry while the SPA renders the panel.
 */
export default function HomePage() {
  return (
    <>
      <div id="app" />
      <div id="toast-root" className="toast-root" aria-live="polite" />
      <Script src="/spa.js" strategy="afterInteractive" />
    </>
  );
}
