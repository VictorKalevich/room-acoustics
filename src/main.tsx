import { render } from 'preact';
import '@fontsource/golos-text/cyrillic-400.css';
import '@fontsource/golos-text/cyrillic-500.css';
import '@fontsource/golos-text/cyrillic-600.css';
import '@fontsource/golos-text/latin-400.css';
import '@fontsource/golos-text/latin-500.css';
import '@fontsource/golos-text/latin-600.css';
import './styles.css';
import { App } from './ui/App';
import { startUpdates } from './ui/updates';
import { installErrorLog } from './state/errlog';

installErrorLog();
render(<App />, document.getElementById('app')!);

// Офлайн-режим и автообновление: service worker регистрируется только в собранной версии по HTTPS
// (на localhost — с параметром ?sw, для проверки обновлений в тестах)
const inFrame = (() => { try { return window.top !== window; } catch { return true; } })();
const swAllowed = location.protocol === 'https:' || (location.hostname === 'localhost' && new URLSearchParams(location.search).has('sw'));
if (import.meta.env.PROD && !inFrame && 'serviceWorker' in navigator && swAllowed) {
  startUpdates();
}
