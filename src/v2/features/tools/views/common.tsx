// Общие блоки экранов инструментов (V2-036–V2-040): активная комната как источник параметров, сохранение результата
// в «Мои данные» (раздел «Расчёты»), форматирование чисел.
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Button, Card, SelectField, useToast } from '../../../design-system';
import { saveToRoom, type ToolMeasurement } from '../../../application/measure';
import type { Room, RoomConfiguration } from '../../../domain/model';
import { putEntry } from '../../../storage/library';
import { useApp } from '../../../shared/context';
import { navigate } from '../../../shared/router';

export { cm, freq, hz, meters, n0, n1, n2, n3, num } from '../../../shared/format';

/** Активная комната (последняя открытая), если она есть. */
export function useActiveRoom(): Room | null {
  const { rooms } = useApp();
  const [room, setRoom] = useState<Room | null>(null);
  useEffect(() => { let alive = true; void rooms.active().then((r) => alive && setRoom(r ?? null), () => undefined); return () => { alive = false; }; }, [rooms]);
  return room;
}

/** Кнопка «Из комнаты»: передаёт текущую конфигурацию активной прямоугольной комнаты. */
export function FromRoom({ onTake, what }: { onTake: (c: RoomConfiguration, room: Room) => void; what: string }) {
  const room = useActiveRoom();
  if (!room || room.current.geometry.kind !== 'rect') return null;
  return <Button small variant="ghost" icon="rooms" onClick={() => onTake(room.current, room)}>{`${what} из комнаты «${room.name}»`}</Button>;
}

/** Сохранить результат инструмента в «Мои данные» → «Расчёты». */
export function SaveResult({ tool, name, data }: { tool: string; name: string; data: () => Record<string, unknown> }) {
  const { db, clock } = useApp();
  const toast = useToast();
  return (
    <Button small variant="ghost" icon="download" onClick={() => {
      const id = clock.newId();
      void putEntry(db, 'calculations', { id, name, kind: 'calculation', tool, createdAt: clock.now(), ...data() })
        .then(() => toast.show('Сохранено в «Мои данные» → «Расчёты»'), () => toast.show('Не удалось сохранить', { tone: 'error' }));
    }}>Сохранить расчёт</Button>
  );
}

/** Карточка инструмента: содержимое столбцом. */
export function Block({ title, subtitle, children }: { title: string; subtitle?: ComponentChildren; children?: ComponentChildren }) {
  return <Card title={title} subtitle={subtitle}><div class="al-stack al-stack--12">{children}</div></Card>;
}

/** Поля ввода сеткой. */
export function Inputs({ children }: { children: ComponentChildren }) {
  return <div class="al-grid al-grid--metrics">{children}</div>;
}

/** Сохранить замер в комнату (по умолчанию активную) и её конфигурацию; build — null, пока замера нет. */
export function SaveToRoom({ build }: { build: () => ToolMeasurement | null }) {
  const { db, rooms, clock } = useApp();
  const toast = useToast();
  const [list, setList] = useState<Room[] | null>(null);
  const [id, setId] = useState('');
  const [role, setRole] = useState<'current' | 'experimental'>('current');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    void Promise.all([rooms.list(), rooms.active()]).then(([l, a]) => { if (alive) { setList(l.rooms); setId(a?.id ?? l.rooms[0]?.id ?? ''); } }, () => alive && setList([]));
    return () => { alive = false; };
  }, [rooms]);
  if (!list) return null;
  if (!list.length) return <p class="al-text-secondary">Создайте комнату, чтобы сохранять замеры с привязкой к ней.</p>;
  const room = list.find((r) => r.id === id) ?? null;
  const save = async () => {
    const m = build();
    if (!m || !room) return;
    setBusy(true);
    try {
      const fresh = (await rooms.open(room.id)) ?? room;
      await saveToRoom(db, rooms, clock, fresh, role === 'experimental' && fresh.experimental ? 'experimental' : 'current', m);
      toast.show(`Замер сохранён в комнату «${fresh.name}»`, { action: { label: 'Открыть', run: () => navigate({ name: 'room', id: fresh.id, tab: 'analysis', section: 'measurements' }) } });
    } catch (e) {
      toast.show(`Не удалось сохранить: ${(e as Error).message}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="al-row al-row--bottom">
      <SelectField label="Комната" value={id} options={list.map((r) => ({ value: r.id, label: r.name }))} onChange={setId} />
      {room?.experimental && <SelectField label="Конфигурация" value={role} options={[{ value: 'current', label: 'Текущая' }, { value: 'experimental', label: 'Эксперимент' }]} onChange={setRole} />}
      <Button variant="primary" small icon="download" busy={busy} onClick={() => void save()}>Сохранить в комнату</Button>
    </div>
  );
}
