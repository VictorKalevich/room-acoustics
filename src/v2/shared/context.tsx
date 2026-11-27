// Общие службы приложения v2: база IndexedDB v2, сценарии комнат, настройки, фоновые расчёты (создаются при первом
// расчёте, не при запуске). Одно место состояния настроек — без копий в экранах.
import { createContext, type ComponentChildren } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Button, ErrorState, LoadingState } from '../design-system';
import { computeClient, type ComputeClient } from '../application/compute';
import { roomsService, systemClock, type Clock, type RoomsService } from '../application/rooms';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type AppSettings } from '../application/settings';
import { openV2Db, StorageError, type V2Db } from '../storage/db';

export interface AppServices {
  db: V2Db;
  rooms: RoomsService;
  clock: Clock;
  settings: AppSettings;
  updateSettings: (edit: (s: AppSettings) => AppSettings) => Promise<void>;
  compute: () => ComputeClient;
}

const AppContext = createContext<AppServices | null>(null);

export function useApp(): AppServices {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp вне AppProvider');
  return ctx;
}

const openDefault = () => openV2Db();

type Boot = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; db: V2Db; settings: AppSettings };

export function AppProvider({ children, open = openDefault, clock = systemClock }: { children: ComponentChildren; open?: () => V2Db | Promise<V2Db>; clock?: Clock }) {
  const [boot, setBoot] = useState<Boot>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<AppSettings>(DEFAULT_SETTINGS);
  const computeRef = useRef<ComputeClient | null>(null);

  useEffect(() => {
    let alive = true;
    let opened: V2Db | null = null;
    (async () => {
      try {
        const db = opened = await open();
        const settings = await loadSettings(db);
        latest.current = settings;
        if (alive) setBoot({ state: 'ready', db, settings });
      } catch (e) {
        if (alive) setBoot({ state: 'error', message: e instanceof StorageError ? e.message : 'Не удалось открыть хранилище браузера.' });
      }
    })();
    return () => { alive = false; opened?.close(); };
    // база открывается один раз на попытку; смена `open` между отрисовками её не переоткрывает
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => () => computeRef.current?.dispose(), []);

  const db = boot.state === 'ready' ? boot.db : null;
  const updateSettings = useCallback(async (edit: (s: AppSettings) => AppSettings) => {
    if (!db) return;
    const next = edit(latest.current);
    latest.current = next;
    setBoot((b) => (b.state === 'ready' ? { ...b, settings: next } : b));
    await saveSettings(db, next);
  }, [db]);

  const value = useMemo<AppServices | null>(() => (boot.state !== 'ready' ? null : {
    db: boot.db, rooms: roomsService(boot.db, clock), clock, settings: boot.settings, updateSettings,
    compute: () => (computeRef.current ??= computeClient()),
  }), [boot, clock, updateSettings]);

  if (boot.state === 'loading') return <main class="al-content al-content--reading"><LoadingState text="Открываем данные…" /></main>;
  if (boot.state === 'error') {
    return (
      <main class="al-content al-content--reading">
        <ErrorState title="Хранилище недоступно" text={<>{boot.message} Возможно, браузер запрещает хранение данных (приватный режим или настройки сайта). Инструменты без сохранения продолжат работать после разрешения хранения.</>} />
        <div class="al-row al-row--end"><Button variant="primary" onClick={() => { setBoot({ state: 'loading' }); setAttempt((a) => a + 1); }}>Повторить</Button></div>
      </main>
    );
  }
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
