// История комнаты (V2-030): отмена и повтор сеанса, неизменяемые снимки конфигурации (сравнить, восстановить в
// эксперимент, сохранить вручную), архив вариантов расстановки, измерения и прогоны подбора с привязкой к конфигурации.
import { useEffect, useState } from 'preact/hooks';
import { Badge, Button, Card, ConfirmDialog, DataTable, EmptyState, useToast } from '../../design-system';
import { snapshotToExperiment, takeSnapshot } from '../../application/experiment';
import { restoreArchived } from '../../domain/operations';
import type { ConfigSnapshot } from '../../domain/model';
import { roomRecords, type RoomRecords } from '../../storage/history';
import { useApp } from '../../shared/context';
import { dateTime } from '../../shared/format';
import { navigate, roomHref } from '../../shared/router';
import type { SectionProps } from '../model/sections';
import { setCompareTarget } from './Compare';

const REASON: Record<ConfigSnapshot['reason'], string> = { 'experiment-confirmed': 'Перед подтверждением эксперимента', measurement: 'При измерении', manual: 'Вручную' };
const ORIGIN = { 'legacy-setup': 'Перенесён из legacy', optimization: 'Подбор', manual: 'Вручную' } as const;
const KIND = { 'frequency-response': 'АЧХ', 'impulse-response': 'Импульсная характеристика', rt60: 'Время реверберации', noise: 'Шум', spl: 'Уровень' } as const;

type Ask = { kind: 'snapshot'; id: string } | { kind: 'archive'; id: string } | null;

export function HistorySection({ h }: SectionProps) {
  const { clock, db } = useApp();
  const toast = useToast();
  const room = h.room!;
  const [ask, setAsk] = useState<Ask>(null);
  const [records, setRecords] = useState<RoomRecords | null>(null);
  useEffect(() => { let alive = true; void roomRecords(db, room.id).then((r) => alive && setRecords(r), () => alive && setRecords({ measurements: [], optimizations: [] })); return () => { alive = false; }; }, [db, room.id]);

  const toExperiment = async () => {
    if (!ask) return;
    const fn = ask.kind === 'snapshot'
      ? (r: typeof room) => snapshotToExperiment(r, ask.id, clock.newId, clock.now())
      : (r: typeof room) => restoreArchived(r, ask.id, clock.newId, clock.now());
    const ok = await h.edit(fn, ask.kind === 'snapshot' ? 'Снимок в эксперимент' : 'Вариант в эксперимент');
    setAsk(null);
    if (ok) { h.setRole('experimental'); toast.show('Перенесено в эксперимент; текущая конфигурация не изменилась'); }
  };
  const configName = (id: string | null) => (id === room.current.id ? 'текущая' : id && id === room.experimental?.id ? 'эксперимент' : id && room.history.some((s) => s.config.id === id) ? 'из истории' : 'неизвестна');

  return (
    <div class="al-stack al-stack--24">
      <Card title="Изменения в этом сеансе" subtitle="Отмена и повтор работают, пока страница открыта (до 50 шагов); сохранённые изменения не теряются.">
        <div class="al-row">
          <Button small icon="undo" disabled={!h.canUndo} onClick={() => void h.undo()}>{h.undoLabel ? `Отменить: ${h.undoLabel}` : 'Отменить'}</Button>
          <Button small icon="redo" disabled={!h.canRedo} onClick={() => void h.redo()}>{h.redoLabel ? `Повторить: ${h.redoLabel}` : 'Повторить'}</Button>
        </div>
      </Card>

      <Card title="Снимки конфигурации" subtitle="Неизменяемые копии текущей конфигурации. Снимок сохраняется перед подтверждением эксперимента и по кнопке."
        actions={<Button small icon="plus" onClick={() => void h.edit((r) => takeSnapshot(r, clock.newId, clock.now()), 'Снимок').then((ok) => ok && toast.show('Снимок текущей конфигурации сохранён'))}>Сохранить снимок</Button>}>
        {room.history.length === 0
          ? <EmptyState icon="history" title="Снимков пока нет" text="Снимок сохраняется при подтверждении эксперимента и по кнопке «Сохранить снимок»." />
          : <DataTable caption="Снимки конфигурации" rowKey={(s) => s.id} rows={room.history} columns={[
            { key: 'at', title: 'Когда', render: (s) => dateTime(s.takenAt) },
            { key: 'why', title: 'Причина', render: (s) => REASON[s.reason] },
            { key: 'act', title: 'Действия', render: (s) => (
              <div class="al-row">
                <Button small variant="ghost" icon="compare" onClick={() => { setCompareTarget(room.id, `snapshot:${s.id}`); navigate(roomHref(room.id, 'model', 'compare')); }} aria-label={`Сравнить снимок от ${dateTime(s.takenAt)} с текущей`}>Сравнить</Button>
                <Button small variant="ghost" icon="flask" onClick={() => setAsk({ kind: 'snapshot', id: s.id })} aria-label={`Снимок от ${dateTime(s.takenAt)} в эксперимент`}>В эксперимент</Button>
              </div>
            ) },
          ]} />}
      </Card>

      {room.archive.length > 0 && (
        <Card title="Архив вариантов расстановки" subtitle="Сохранённые места колонок, сабвуферов и слушателя. Вариант восстанавливается только в эксперимент.">
          <DataTable caption="Архив вариантов" rowKey={(v) => v.id} rows={room.archive} columns={[
            { key: 'name', title: 'Вариант', render: (v) => v.name },
            { key: 'when', title: 'Сохранён', render: (v) => (v.savedAt ? dateTime(v.savedAt) : 'время неизвестно') },
            { key: 'origin', title: 'Откуда', render: (v) => ORIGIN[v.origin] },
            { key: 'act', title: 'Действия', render: (v) => <Button small variant="ghost" icon="flask" onClick={() => setAsk({ kind: 'archive', id: v.id })} aria-label={`Вариант «${v.name}» в эксперимент`}>В эксперимент</Button> },
          ]} />
        </Card>
      )}

      <Card title="Измерения и подборы" subtitle="Записи не меняются: повторная обработка создаёт новый результат. Конфигурация — к которой относится запись.">
        {!records ? <p class="al-text-small al-text-secondary">Загрузка…</p> : records.measurements.length + records.optimizations.length === 0
          ? <p class="al-text-small al-text-secondary">Измерений и сохранённых подборов для этой комнаты нет.</p>
          : (
            <div class="al-stack al-stack--16">
              {records.measurements.length > 0 && <DataTable caption="Измерения" rowKey={(m) => m.id} rows={records.measurements} columns={[
                { key: 'at', title: 'Когда', render: (m) => dateTime(m.recordedAt) },
                { key: 'name', title: 'Измерение', render: (m) => `${m.name} · ${KIND[m.kind]}` },
                { key: 'cfg', title: 'Конфигурация', render: (m) => configName(m.configId) },
                { key: 'snap', title: 'Снимок при записи', render: (m) => (m.snapshotId ? <Badge tone="success" icon={false}>есть</Badge> : <Badge tone="neutral" icon={false}>{m.lateBinding ? 'нет, привязано позже' : 'нет'}</Badge>) },
              ]} />}
              {records.optimizations.length > 0 && <DataTable caption="Прогоны подбора" rowKey={(o) => o.id} rows={records.optimizations} columns={[
                { key: 'at', title: 'Когда', render: (o) => (o.createdAt ? dateTime(o.createdAt) : 'время неизвестно') },
                { key: 'cfg', title: 'Конфигурация', render: (o) => configName(o.configId) },
                { key: 'state', title: 'Состояние', render: (o) => (o.stale ? <Badge tone="warning">Устарел</Badge> : <Badge tone="success" icon={false}>Актуален</Badge>) },
              ]} />}
            </div>
          )}
      </Card>

      {ask && (
        <ConfirmDialog title="Перенести в эксперимент?" confirmLabel="В эксперимент" onCancel={() => setAsk(null)} onConfirm={() => void toExperiment()}
          text={ask.kind === 'snapshot'
            ? (room.experimental ? 'Эксперимент заменится конфигурацией из снимка. Текущая конфигурация и снимок не изменятся.' : 'Будет создан эксперимент с конфигурацией из снимка. Текущая конфигурация и снимок не изменятся.')
            : (room.experimental ? 'Места источников и слушателя из варианта перенесутся в существующий эксперимент. Текущая конфигурация и архив не изменятся.' : 'Будет создан эксперимент — копия текущей конфигурации с местами из варианта. Текущая конфигурация и архив не изменятся.')} />
      )}
    </div>
  );
}
