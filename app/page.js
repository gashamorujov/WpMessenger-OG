'use client';
import PanelShell from './panel-shell';

/**
 * Home — real path "/" (Başlanğıc). The SPA (public/spa.js) reads the
 * pathname and restores the dashboard route on refresh / direct links.
 */
export default function HomePage() {
  return <PanelShell />;
}
