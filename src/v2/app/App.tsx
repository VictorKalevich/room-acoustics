import { useEffect, useState } from 'preact/hooks';
import { ToastHost } from '../design-system';
import { Catalog } from '../features/catalog/Catalog';

const useHash = () => {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
};

export function App() {
  const hash = useHash();
  if (hash === '#/catalog') return <ToastHost><main class="shell__page"><Catalog /></main></ToastHost>;
  return (
    <main class="shell__page">
      <div class="shell">
        <p class="shell__stage">Этап 3 — дизайн-система</p>
        <h1 class="shell__title">Room Acoustics v2</h1>
        <p class="shell__status">Создана отдельная точка входа новой версии. Комнаты, инструменты, измерения и расчёты появятся на следующих этапах.</p>
        <p class="shell__note">Эта страница не сохраняет данные, не обращается к микрофону и не воспроизводит звук. Действующее приложение работает отдельно и не изменено.</p>
      </div>
    </main>
  );
}
