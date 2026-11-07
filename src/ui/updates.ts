// Автообновление PWA: проверка новой версии при запуске, при возврате в приложение и раз в 30 минут.
// На iPhone приложение с экрана «Домой» обычно не перезагружается, а просыпается из памяти,
// поэтому проверка при возврате (visibilitychange) — главный путь обновления.

export const BUILD = { time: __APP_BUILD_TIME__, sha: __APP_BUILD_SHA__ };

export type UpdateStatus = 'idle' | 'checking' | 'latest' | 'updating' | 'unsupported' | 'error';

let registration: ServiceWorkerRegistration | undefined;
let status: UpdateStatus = 'idle';
let lastCheck = 0;
const listeners = new Set<(s: UpdateStatus) => void>();
let beforeReload: (() => Promise<unknown>) | undefined;

function set(s: UpdateStatus) {
  status = s;
  listeners.forEach((l) => l(s));
}

export function getStatus(): UpdateStatus {
  return registration ? status : 'unsupported';
}

export function onStatus(l: (s: UpdateStatus) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Действие перед перезагрузкой на новую версию (сохранить черновик проекта). */
export function setBeforeReload(fn: () => Promise<unknown>) {
  beforeReload = fn;
}

/** Ищет новую версию на сервере. Если она есть, service worker установит её и страница перезагрузится. */
export async function checkForUpdate(manual = false): Promise<void> {
  const r = registration;
  if (!r) return;
  if (!manual && Date.now() - lastCheck < 60_000) return;
  if (!navigator.onLine) { if (manual) set('error'); return; }
  lastCheck = Date.now();
  if (manual) set('checking');
  try {
    await r.update();
    if (r.installing || r.waiting) set('updating');
    else if (manual) set('latest');
  } catch {
    if (manual) set('error');
  }
}

async function reload() {
  set('updating');
  try { sessionStorage.setItem('ra-updated', '1'); } catch { /* приватный режим */ }
  try { await Promise.race([beforeReload?.(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* сохранение не критично */ }
  location.reload();
}

/** Было ли приложение только что обновлено (один раз после перезагрузки). */
export function consumeJustUpdated(): boolean {
  try {
    const v = sessionStorage.getItem('ra-updated') === '1';
    sessionStorage.removeItem('ra-updated');
    return v;
  } catch {
    return false;
  }
}

export function startUpdates() {
  import('virtual:pwa-register')
    .then(({ registerSW }) =>
      registerSW({
        immediate: true,
        onNeedReload: () => { void reload(); },
        onRegisteredSW: (_url, r) => {
          if (!r) return;
          registration = r;
          set('idle');
          r.addEventListener('updatefound', () => set('updating'));
          setInterval(() => void checkForUpdate(), 30 * 60_000);
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') void checkForUpdate();
          });
          addEventListener('online', () => void checkForUpdate());
          addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) void checkForUpdate(); });
        },
      }),
    )
    .catch(() => undefined);
}
