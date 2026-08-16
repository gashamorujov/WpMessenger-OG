'use client';

/**
 * Shared panel shell — every real route (/, /connect, /contacts, /send,
 * /history, /processes, /settings) renders the same SPA mount point.
 * The interactive UI lives in public/spa.js and reads location.pathname,
 * so browser refresh, back/forward and direct links all work.
 */
export default function PanelShell() {
  return (
    <>
      <div id="app" />
      <div id="toast-root" className="toast-root" aria-live="polite" />
    </>
  );
}
