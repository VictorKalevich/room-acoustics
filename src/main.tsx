import { render } from 'preact';
import '@fontsource/golos-text/cyrillic-400.css';
import '@fontsource/golos-text/cyrillic-500.css';
import '@fontsource/golos-text/cyrillic-600.css';
import '@fontsource/golos-text/latin-400.css';
import '@fontsource/golos-text/latin-500.css';
import '@fontsource/golos-text/latin-600.css';
import './styles.css';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);

// Офлайн-режим: service worker регистрируется только в собранной версии по HTTPS
const inFrame = (() => { try { return window.top !== window; } catch { return true; } })();
if (import.meta.env.PROD && !inFrame && 'serviceWorker' in navigator && location.protocol === 'https:') {
  import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true })).catch(() => undefined);
}
