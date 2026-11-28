// Свойства выбранного объекта (V2-022–V2-024): точный ввод координат, размеров и параметров, блокировка, зеркало,
// удаление. Поля скрытых уровней не сбрасываются — они просто не показываются.
import { useEffect, useState } from 'preact/hooks';
import { Badge, Button, Card, Checkbox, Notice, NumberField, SelectField, Switch, TextField } from '../../design-system';
import { THICKNESSES } from '../../../core/treatments';
import type { FurnitureType, WallId } from '../../../core/types';
import {
  FURNITURE_LABEL, WALL_LABEL, isLocked, lockRef, mirrorOf, mirrorSource, patchCovering, patchListener, patchObstacle, patchSource, patchTreatment,
  removeRef, rotateObstacle, upsertOpening, type EditRef,
} from '../../application/editing';
import { visibleAt } from '../../domain/complexity';
import type { Complexity, DiffuserItem, OpeningState, ResonatorItem, RoomConfiguration, TreatmentItem } from '../../domain/model';
import { isKnown } from '../../domain/units';
import { EquipmentBlock } from './ProfileBlocks';
import type { ConfigEdit } from './useConfig';

const WALLS: WallId[] = ['front', 'back', 'left', 'right'];
const wallOptions = WALLS.map((w) => ({ value: w, label: `${WALL_LABEL[w][0].toUpperCase()}${WALL_LABEL[w].slice(1)} стена` }));
const STATE_LABEL: Record<OpeningState, string> = { closed: 'Закрыто', open: 'Открыто', permanent: 'Постоянный проём', 'unknown-neighbour': 'Открыто в неописанное помещение' };
const CORNERS = ['front-left', 'front-right', 'back-left', 'back-right'] as const;
export const CORNER_LABEL: Record<(typeof CORNERS)[number], string> = { 'front-left': 'Передний левый', 'front-right': 'Передний правый', 'back-left': 'Задний левый', 'back-right': 'Задний правый' };
const DIFFUSER_LABEL: Record<DiffuserItem['design'], string> = { 'qrd-1d': 'QRD 1D', 'qrd-2d': 'QRD 2D', skyline: 'Skyline', prd: 'PRD', cylinder: 'Полуцилиндр', relief: 'Произвольный рельеф' };
const RESONATOR_LABEL: Record<ResonatorItem['design'], string> = { helmholtz: 'Гельмгольц', membrane: 'Мембранный', perforated: 'Перфорированный', slot: 'Щелевой' };

function M({ label, value, onCommit, min, max, unit = 'м', decimals = 2, hint }: { label: string; value: number | null; onCommit: (v: number) => void; min?: number; max?: number; unit?: string; decimals?: number; hint?: string }) {
  return <NumberField label={label} unit={unit} value={value} onCommit={onCommit} min={min} max={max} decimals={decimals} hint={hint} />;
}

export function Properties({ edit, refx, level, onClose }: { edit: ConfigEdit; refx: EditRef; level: Complexity; onClose: () => void }) {
  const c = edit.config;
  const g = c.geometry.kind === 'rect' ? c.geometry : null;
  if (!g) return null;
  const locked = isLocked(c, refx);
  const lockable = refx.type === 'source' || refx.type === 'listener' || refx.type === 'obstacle' || refx.type === 'treatment';
  const del = () => { void edit.apply((x) => removeRef(x, refx), 'Удаление'); onClose(); };
  const footer = (
    <div class="al-row al-row--12">
      {lockable && <Switch label="Закрепить" checked={locked} onChange={(v) => edit.apply((x) => lockRef(x, refx, v), v ? 'Закрепление' : 'Открепление')} hint="Не двигается на плане и при подборе" />}
      <Button variant="danger-ghost" icon="trash" small onClick={del}>Удалить</Button>
    </div>
  );
  const body = (() => {
    switch (refx.type) {
      case 'source': return <SourceProps c={c} id={refx.id} edit={edit} level={level} />;
      case 'listener': return <ListenerProps c={c} id={refx.id} edit={edit} level={level} />;
      case 'obstacle': return <ObstacleProps c={c} id={refx.id} edit={edit} />;
      case 'covering': return <CoveringProps c={c} id={refx.id} edit={edit} />;
      case 'treatment': return <TreatmentProps c={c} id={refx.id} edit={edit} level={level} />;
      case 'opening': return <OpeningProps c={c} id={refx.id} edit={edit} />;
    }
  })();
  if (!body) return null;
  return (
    <Card title="Свойства" actions={<Button variant="ghost" small icon="close" onClick={onClose} aria-label="Закрыть свойства">Закрыть</Button>}>
      <div class="al-stack al-stack--16" data-testid="properties">
        {body}
        {footer}
      </div>
    </Card>
  );
}

/** Название: применяется при выходе из поля; пустое возвращает прежнее. */
export function NameField({ value, onCommit, label = 'Название' }: { value: string; onCommit: (v: string) => void; label?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <TextField label={label} value={text} onInput={setText} maxLength={60} onCommit={(v) => { const t = v.trim(); if (t && t !== value) onCommit(t); else setText(value); }} />;
}

function SourceProps({ c, id, edit, level }: { c: RoomConfiguration; id: string; edit: ConfigEdit; level: Complexity }) {
  const s = c.audio.sources.find((x) => x.id === id);
  if (!s) return null;
  const g = c.geometry as { depth: number; width: number; height: number };
  const set = (patch: Parameters<typeof patchSource>[2], label = 'Источник') => edit.apply((x) => patchSource(x, id, patch), label);
  const pos = (k: 'x' | 'y' | 'z') => (v: number) => set({ position: { ...s.position, [k]: v } }, 'Перемещение');
  const pair = mirrorOf(c, id);
  const caps = s.capabilities;
  const box = s.box && isKnown(s.box) ? s.box : null;
  return (
    <>
      <div class="al-row"><Badge tone="neutral" icon={false}>{s.kind === 'sub' ? 'Сабвуфер' : 'Колонка'}</Badge>{s.channel && <Badge tone="neutral" icon={false}>Канал {s.channel}</Badge>}</div>
      <NameField value={s.name} onCommit={(v) => set({ name: v }, 'Название')} />
      <div class="al-grid">
        <M label="X — от передней стены" value={s.position.x} min={0} max={g.depth} onCommit={pos('x')} />
        <M label="Y — от левой стены" value={s.position.y} min={0} max={g.width} onCommit={pos('y')} />
        <M label="Высота акустического центра" value={s.position.z} min={0} max={g.height} onCommit={pos('z')} />
        <M label="Поворот" unit="°" decimals={0} value={s.rotationDeg} min={-180} max={180} onCommit={(v) => set({ rotationDeg: v }, 'Поворот')} hint="0 — к задней стене, плюс — к правой" />
        <M label="Нижняя граница" unit="Гц" decimals={0} value={s.fLow} min={5} max={20000} onCommit={(v) => set({ fLow: v }, 'Диапазон')} />
        <M label="Верхняя граница" unit="Гц" decimals={0} value={s.fHigh} min={10} max={40000} onCommit={(v) => set({ fHigh: v }, 'Диапазон')} />
      </div>
      {visibleAt('advanced', level) && (
        <div class="al-stack al-stack--12">
          <p class="al-text-small al-text-secondary">Корпус: {box ? `${box.w} × ${box.h} × ${box.d} м` : 'размеры неизвестны — расстояния считаются от акустического центра'}</p>
          <div class="al-grid">
            <M label="Ширина корпуса" value={box?.w ?? null} min={0.05} max={2} onCommit={(v) => set({ box: { w: v, h: box?.h ?? 0.3, d: box?.d ?? 0.3 } }, 'Корпус')} />
            <M label="Высота корпуса" value={box?.h ?? null} min={0.05} max={2.5} onCommit={(v) => set({ box: { w: box?.w ?? 0.2, h: v, d: box?.d ?? 0.3 } }, 'Корпус')} />
            <M label="Глубина корпуса" value={box?.d ?? null} min={0.05} max={2} onCommit={(v) => set({ box: { w: box?.w ?? 0.2, h: box?.h ?? 0.3, d: v } }, 'Корпус')} />
          </div>
          {s.kind === 'sub' && (
            <div class="al-grid">
              <SelectField label="Задержка в устройстве" value={caps.delayMode ?? 'none'} onChange={(v) => set({ capabilities: { ...caps, delayMode: v } }, 'Возможности')} options={[{ value: 'none', label: 'Нет' }, { value: 'adjustable', label: 'Регулируется' }]} />
              <SelectField label="Фаза" value={caps.phaseMode ?? 'none'} onChange={(v) => set({ capabilities: { ...caps, phaseMode: v } }, 'Возможности')} options={[{ value: 'none', label: 'Нет' }, { value: 'polarity', label: 'Полярность 0/180°' }, { value: 'continuous', label: 'Плавная' }, { value: 'full', label: 'Плавная и полярность' }]} />
              <M label="Полосы PEQ" unit="шт." decimals={0} value={caps.peqBands ?? 0} min={0} max={20} onCommit={(v) => set({ capabilities: { ...caps, peqBands: v } }, 'Возможности')} />
              <Checkbox label="Регулировка уровня" checked={caps.levelAdjustable ?? false} onChange={(v) => set({ capabilities: { ...caps, levelAdjustable: v } }, 'Возможности')} />
            </div>
          )}
        </div>
      )}
      {visibleAt('advanced', level) && <EquipmentBlock s={s} edit={edit} />}
      {pair && <Button small icon="copy" onClick={() => edit.apply((x) => mirrorSource(x, id), 'Зеркало')}>Зеркально для «{pair.name}»</Button>}
    </>
  );
}

function ListenerProps({ c, id, edit, level }: { c: RoomConfiguration; id: string; edit: ConfigEdit; level: Complexity }) {
  const l = c.listening.listeners.find((x) => x.id === id);
  if (!l) return null;
  const g = c.geometry as { depth: number; width: number; height: number };
  const set = (patch: Parameters<typeof patchListener>[2], label = 'Слушатель') => edit.apply((x) => patchListener(x, id, patch), label);
  const pos = (k: 'x' | 'y' | 'z') => (v: number) => set({ position: { ...l.position, [k]: v } }, 'Перемещение');
  return (
    <>
      <div class="al-row"><Badge tone={l.primary ? 'current' : 'neutral'} icon={false}>{l.primary ? 'Основное место' : 'Дополнительное место'}</Badge></div>
      <div class="al-grid">
        <M label="X — от передней стены" value={l.position.x} min={0} max={g.depth} onCommit={pos('x')} />
        <M label="Y — от левой стены" value={l.position.y} min={0} max={g.width} onCommit={pos('y')} />
        <M label="Высота ушей" value={l.position.z} min={0.3} max={g.height} onCommit={pos('z')} />
        {visibleAt('advanced', level) && <M label="Вес в оценке" unit="" decimals={1} value={l.weight} min={0} max={10} onCommit={(v) => set({ weight: v }, 'Вес')} />}
      </div>
      {!l.primary && <Button small onClick={() => set({ primary: true }, 'Основное место')}>Сделать основным</Button>}
    </>
  );
}

function ObstacleProps({ c, id, edit }: { c: RoomConfiguration; id: string; edit: ConfigEdit }) {
  const z = c.interior.obstacles.find((x) => x.id === id);
  if (!z) return null;
  const set = (patch: Parameters<typeof patchObstacle>[2], label = 'Предмет') => edit.apply((x) => patchObstacle(x, id, patch), label);
  const cx = (z.x0 + z.x1) / 2, cy = (z.y0 + z.y1) / 2, dx = z.x1 - z.x0, dy = z.y1 - z.y0;
  return (
    <>
      <SelectField<FurnitureType> label="Тип" value={z.furniture ?? 'other'} onChange={(t) => set({ furniture: t, name: FURNITURE_LABEL[t] }, 'Тип предмета')}
        options={(Object.keys(FURNITURE_LABEL) as FurnitureType[]).map((t) => ({ value: t, label: FURNITURE_LABEL[t] }))} />
      <div class="al-grid">
        <M label="Центр, X" value={cx} onCommit={(v) => set({ x0: v - dx / 2, x1: v + dx / 2 }, 'Перемещение')} />
        <M label="Центр, Y" value={cy} onCommit={(v) => set({ y0: v - dy / 2, y1: v + dy / 2 }, 'Перемещение')} />
        <M label="Размер по X (вглубь)" value={dx} min={0.1} onCommit={(v) => set({ x0: cx - v / 2, x1: cx + v / 2 }, 'Размер')} />
        <M label="Размер по Y (вдоль передней стены)" value={dy} min={0.1} onCommit={(v) => set({ y0: cy - v / 2, y1: cy + v / 2 }, 'Размер')} />
        <M label="Высота" value={z.height ?? null} min={0.05} onCommit={(v) => set({ height: v }, 'Высота')} />
      </div>
      <Switch label="Можно сидеть" checked={z.canSit} onChange={(v) => set({ canSit: v }, 'Предмет')} />
      <Button small icon="undo" onClick={() => edit.apply((x) => rotateObstacle(x, id), 'Поворот')}>Повернуть на 90°</Button>
    </>
  );
}

function CoveringProps({ c, id, edit }: { c: RoomConfiguration; id: string; edit: ConfigEdit }) {
  const cv = c.interior.coverings.find((x) => x.id === id);
  if (!cv) return null;
  const set = (patch: Parameters<typeof patchCovering>[2]) => edit.apply((x) => patchCovering(x, id, patch), 'Покрытие');
  return (
    <>
      <SelectField label="Вид" value={cv.grade} onChange={(v) => set({ grade: v })} options={cv.kind === 'carpet' ? [{ value: 'thin', label: 'Тонкий ковёр' }, { value: 'thick', label: 'Толстый на подложке' }] : [{ value: 'light', label: 'Лёгкие шторы' }, { value: 'heavy', label: 'Плотные в складку' }]} />
      <div class="al-grid">
        <M label="От" value={cv.u0} onCommit={(v) => set({ u0: v })} />
        <M label="До" value={cv.u1} onCommit={(v) => set({ u1: v })} />
        <M label={cv.surface === 'floor' ? 'Поперёк от' : 'Низ'} value={cv.v0} onCommit={(v) => set({ v0: v })} />
        <M label={cv.surface === 'floor' ? 'Поперёк до' : 'Верх'} value={cv.v1} onCommit={(v) => set({ v1: v })} />
      </div>
    </>
  );
}

function TreatmentProps({ c, id, edit, level }: { c: RoomConfiguration; id: string; edit: ConfigEdit; level: Complexity }) {
  const t = c.treatment.items.find((x) => x.id === id);
  if (!t) return null;
  const g = c.geometry as { depth: number; width: number; height: number };
  const set = (patch: Partial<TreatmentItem>, label = 'Обработка') => edit.apply((x) => patchTreatment(x, id, patch), label);
  const enabled = <Switch label="Учитывать" checked={t.enabled !== false} onChange={(v) => set({ enabled: v })} />;
  if (t.kind === 'corner') {
    return (
      <>
        <SelectField label="Угол" value={t.corner ?? 'front-left'} onChange={(v) => set({ corner: v })} options={CORNERS.map((k) => ({ value: k, label: CORNER_LABEL[k] }))} />
        <div class="al-grid">
          <M label="Ширина фасада" value={t.width} min={0.1} max={2} onCommit={(v) => set({ width: v })} />
          <M label="Высота" value={t.height} min={0.1} max={g.height} onCommit={(v) => set({ height: v })} />
          <SelectField label="Толщина поглотителя" value={String(t.thickness)} onChange={(v) => set({ thickness: Number(v) })} options={THICKNESSES.map((d) => ({ value: String(d), label: `${d * 100} см` }))} />
        </div>
        <Notice>Упрощённая модель: пористый слой в углу. Сложная угловая конструкция (superchunk, панель под 45° с полостью) этим расчётом точно не описывается.</Notice>
        {enabled}
      </>
    );
  }
  if (t.kind === 'cloud') {
    return (
      <>
        <div class="al-grid">
          <M label="Центр, X" value={t.x ?? g.depth / 2} onCommit={(v) => set({ x: v })} />
          <M label="Центр, Y" value={t.y ?? g.width / 2} onCommit={(v) => set({ y: v })} />
          <M label="Ширина (поперёк)" value={t.width} min={0.1} onCommit={(v) => set({ width: v })} />
          <M label="Длина (вдоль)" value={t.height} min={0.1} onCommit={(v) => set({ height: v })} />
          <SelectField label="Толщина" value={String(t.thickness)} onChange={(v) => set({ thickness: Number(v) })} options={THICKNESSES.map((d) => ({ value: String(d), label: `${d * 100} см` }))} />
          <M label="Зазор до потолка" value={t.gap ?? 0} min={0} max={1} onCommit={(v) => set({ gap: v })} />
        </div>
        {enabled}
      </>
    );
  }
  const L = t.wall === 'front' || t.wall === 'back' ? g.width : g.depth;
  const common = (
    <>
      <SelectField label="Стена" value={t.wall!} onChange={(v) => set({ wall: v })} options={wallOptions} />
      <div class="al-grid">
        <M label="Центр вдоль стены" value={t.at ?? L / 2} min={0} max={L} onCommit={(v) => set({ at: v })} />
        <M label="Центр по высоте" value={t.z ?? g.height / 2} min={0} max={g.height} onCommit={(v) => set({ z: v })} />
        <M label="Ширина" value={t.width} min={0.1} max={L} onCommit={(v) => set({ width: v })} />
        <M label="Высота" value={t.height} min={0.1} max={g.height} onCommit={(v) => set({ height: v })} />
      </div>
    </>
  );
  if (t.kind === 'panel') {
    return (
      <>
        {common}
        <div class="al-grid">
          <SelectField label="Толщина" value={String(t.thickness)} onChange={(v) => set({ thickness: Number(v) })} options={THICKNESSES.map((d) => ({ value: String(d), label: `${d * 100} см` }))} />
          <M label="Воздушный зазор" value={t.gap ?? 0} min={0} max={0.5} onCommit={(v) => set({ gap: v })} />
        </div>
        {enabled}
      </>
    );
  }
  if (t.kind !== 'diffuser' && t.kind !== 'resonator') return null;
  return (
    <>
      {t.kind === 'diffuser'
        ? <SelectField label="Конструкция" value={t.design} onChange={(v) => set({ design: v } as Partial<DiffuserItem>)} options={(Object.keys(DIFFUSER_LABEL) as DiffuserItem['design'][]).map((k) => ({ value: k, label: DIFFUSER_LABEL[k] }))} />
        : <SelectField label="Конструкция" value={t.design} onChange={(v) => set({ design: v } as Partial<ResonatorItem>)} options={(Object.keys(RESONATOR_LABEL) as ResonatorItem['design'][]).map((k) => ({ value: k, label: RESONATOR_LABEL[k] }))} />}
      {common}
      <div class="al-grid">
        <M label="Глубина" value={t.depth} min={0.02} max={1} onCommit={(v) => set({ depth: v })} />
        {t.kind === 'resonator' && visibleAt('advanced', level) && (
          <NumberField label="Частота настройки" unit="Гц" decimals={0} optional value={isKnown(t.tuningHz) ? t.tuningHz : null} min={20} max={1000}
            hint="Пусто — неизвестна" onCommit={(v) => set({ tuningHz: Number.isFinite(v) ? v : { missing: 'unknown' } } as Partial<ResonatorItem>)} />
        )}
      </div>
      <Notice tone="warning">{t.kind === 'diffuser' ? 'Диффузор' : 'Резонатор'} пока не входит в расчёт ядра: показан на плане и в списке, в акустическом расчёте не учитывается.</Notice>
      {enabled}
    </>
  );
}

function OpeningProps({ c, id, edit }: { c: RoomConfiguration; id: string; edit: ConfigEdit }) {
  const o = c.openings.find((x) => x.id === id);
  if (!o) return null;
  const g = c.geometry as { depth: number; width: number; height: number };
  const L = o.wall === 'front' || o.wall === 'back' ? g.width : g.depth;
  const set = (patch: Partial<typeof o>) => edit.apply((x) => upsertOpening(x, { ...o, ...patch }), 'Проём');
  return (
    <>
      <div class="al-grid">
        <SelectField label="Вид" value={o.kind} onChange={(v) => set({ kind: v })} options={[{ value: 'door', label: 'Дверь' }, { value: 'window', label: 'Окно' }, { value: 'passage', label: 'Проём' }]} />
        <SelectField label="Состояние" value={o.state} onChange={(v) => set({ state: v })} options={(Object.keys(STATE_LABEL) as OpeningState[]).map((k) => ({ value: k, label: STATE_LABEL[k] }))} />
        <SelectField label="Стена" value={o.wall} onChange={(v) => set({ wall: v })} options={wallOptions} />
        <M label="Начало вдоль стены" value={o.a0} min={0} max={L} onCommit={(v) => set({ a0: v })} />
        <M label="Конец вдоль стены" value={o.a1} min={0} max={L} onCommit={(v) => set({ a1: v })} />
        <M label="Низ" value={o.bottom} min={0} max={g.height} onCommit={(v) => set({ bottom: v })} />
        <M label="Верх" value={o.top} min={0} max={g.height} onCommit={(v) => set({ top: v })} />
      </div>
      <p class="al-text-small al-text-secondary">Вдоль передней и задней стены отсчёт от левой стены, вдоль левой и правой — от передней.</p>
      {o.state === 'unknown-neighbour' && <Notice tone="warning">Соседнее помещение не описано: проём считается выходом в большой объём. Опишите смежную зону, если она известна.</Notice>}
    </>
  );
}
