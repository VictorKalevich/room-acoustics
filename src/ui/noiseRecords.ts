import { useCallback, useEffect, useState } from 'preact/hooks';
import { recordView, type NoiseRecord, type NoiseRecordHeader, type NoiseView } from '../core/noiseRecord';
import { noiseHistory, type HistoryList } from '../state/noiseHistory';
import { S } from './strings';

/** Общие части библиотеки и сравнения истории шумомера (056). */
export const newRecordId = () => globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
export const dateText = (iso: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
};
export const displayName = (h: Pick<NoiseRecordHeader, 'name' | 'startedAt' | 'savedAt'>) => h.name || S.noise.store.untitled(dateText(h.startedAt ?? h.savedAt));
export const errorText = (e: unknown) => (e as Error)?.message || 'ошибка';

/** Список истории для сводки на экране шумомера и библиотеки. */
export function useNoiseHistory() {
  const [list, setList] = useState<HistoryList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    noiseHistory.list().then(l => { setList(l); setError(null); }, e => setError(errorText(e)));
  }, []);
  useEffect(reload, [reload]);
  return { list, error, reload };
}

export type LoadedRecord = { record: NoiseRecord; view: NoiseView } | { error: string };
/** Загрузка записи на время открытия: закрытие освобождает данные. Микрофон не запрашивается. */
export function useRecord(id: string | null, open: boolean) {
  const [state, setState] = useState<LoadedRecord | null>(null);
  useEffect(() => {
    setState(null);
    if (!open || !id) return;
    let live = true;
    noiseHistory.read(id).then(record => { if (live) setState({ record, view: recordView(record.content, record.context) }); },
      e => { if (live) setState({ error: errorText(e) }); });
    return () => { live = false; };
  }, [id, open]);
  return state;
}
