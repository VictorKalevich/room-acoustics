// Разделы вкладки «Модель» (V2-021–V2-023): помещение, аудиосистема, слушатели, интерьер, обработка, параметры
// расчёта, история. Списки объектов открывают те же свойства, что и план. Скрытые уровнем параметры не сбрасываются.
import { useState } from 'preact/hooks';
import {
  Badge, Button, Card, NumberField, Notice, SegmentedControl, SelectField, Switch, useToast,
} from '../../design-system';
import { FURNITURE_ORDER } from '../../../core/furniture';
import { FURNISHING_LABEL } from '../../../core/materials';
import { PRECISIONS, type Precision } from '../../../core/precision';
import { SURFACES, type AcousticModel, type Extension, type Furnishing, type Leakage, type SubZone, type WallId } from '../../../core/types';
import {
  FURNITURE_LABEL, TREATMENT_LABEL, WALL_LABEL, addCovering, addFurniture, addListener, addSource, addTreatment, newOpening, newTreatment,
  newZone, removeZone, setDimensions, setLayout, setSlope, upsertOpening, upsertZone, type EditRef, type TreatmentKind,
} from '../../application/editing';
import { hiddenOverrides, resetParams, visibleAt } from '../../domain/complexity';
import type { Complexity, RoomConfiguration, SystemLayout } from '../../domain/model';
import { DIM_LABEL, DIM_LIMITS } from '../../domain/validation';
import { useApp } from '../../shared/context';
import type { RoomHandle } from '../rooms/useRoom';
import { CORNER_LABEL, NameField, Properties } from './Properties';
import { resetCalibration } from '../../application/measure';
import { ScanCard } from './ScanCard';
import { SurfaceField, useMaterials } from './ProfileBlocks';
import { ShapeCard } from './ShapeCard';
import type { ConfigEdit } from './useConfig';

export interface SectionProps { h: RoomHandle; edit: ConfigEdit; level: Complexity }

const WALLS: WallId[] = ['front', 'back', 'left', 'right'];
const wallOptions = WALLS.map((w) => ({ value: w, label: `${WALL_LABEL[w][0].toUpperCase()}${WALL_LABEL[w].slice(1)} стена` }));
const LEAKAGE_LABEL: Record<Leakage, string> = { sealed: 'Закрыта наглухо', typical: 'Обычная, двери закрыты', door: 'Открытая дверь', open: 'Открытая планировка' };
const MODEL_LABEL: Record<AcousticModel, string> = { auto: 'Авто', modal: 'Прямоугольная (быстро)', wave: 'Волновая (точнее)' };
const PRECISION_LABEL: Record<Precision, string> = { standard: 'Стандартная', high: 'Высокая', max: 'Максимальная' };
const SUBZONE_LABEL: Record<SubZone, string> = { corners: 'Углы', walls: 'Вдоль стен', anywhere: 'Где угодно' };
const LAYOUT_OPTIONS: { value: Exclude<SystemLayout, 'custom'>; label: string }[] = [
  { value: 'mono', label: '1.0' }, { value: '2.0', label: '2.0' }, { value: '2.1', label: '2.1' }, { value: '2.2', label: '2.2' }, { value: '5.1', label: '5.1' },
];
const OPENING_KIND = { door: 'Дверь', window: 'Окно', passage: 'Проём' } as const;
const m2 = (v: number) => v.toFixed(2).replace('.', ',');

interface Row { ref: EditRef; title: string; meta: string; badge?: string }

/** Список объектов раздела и свойства выбранного рядом (на узком экране — под списком). */
function ObjectList({ label, rows, edit, level, empty }: { label: string; rows: Row[]; edit: ConfigEdit; level: Complexity; empty: string }) {
  const [sel, setSel] = useState<string | null>(null);
  const picked = rows.find((r) => `${r.ref.type}:${r.ref.id}` === sel);
  if (!rows.length) return <p class="al-text-small al-text-secondary">{empty}</p>;
  return (
    <div class="al-split">
      <ul class="al-list" aria-label={label}>
        {rows.map((r) => {
          const key = `${r.ref.type}:${r.ref.id}`;
          return (
            <li key={key}>
              <button type="button" class="al-list__item" aria-pressed={key === sel} onClick={() => setSel(key === sel ? null : key)}>
                <span class="al-list__text"><span class="al-list__title">{r.title}</span><span class="al-list__meta">{r.meta}</span></span>
                {r.badge && <Badge tone="neutral" icon={false}>{r.badge}</Badge>}
              </button>
            </li>
          );
        })}
      </ul>
      <div class="al-split__aside">{picked && <Properties edit={edit} refx={picked.ref} level={level} onClose={() => setSel(null)} />}</div>
    </div>
  );
}

// ---------- Помещение ----------

export function GeometrySection({ edit, level }: SectionProps) {
  const toast = useToast();
  const { clock } = useApp();
  const [wall, setWall] = useState<WallId>('back');
  const materials = useMaterials();
  const c = edit.config;
  if (c.geometry.kind !== 'rect') return <Notice tone="warning">Произвольный контур пока редактируется только в legacy-версии.</Notice>;
  const g = c.geometry;
  const dim = (k: 'depth' | 'width' | 'height') => (v: number) => {
    let notes: string[] = [];
    void edit.apply((x) => { const r = setDimensions(x, { depth: g.depth, width: g.width, height: g.height, [k]: v }); notes = r.notes; return r.config; }, 'Размеры')
      .then((ok) => { if (ok && notes.length) toast.show(notes.join(' ')); });
  };
  const rows: Row[] = c.openings.map((o) => ({
    ref: { type: 'opening', id: o.id }, title: `${OPENING_KIND[o.kind]} — ${WALL_LABEL[o.wall]} стена`,
    meta: `${m2(o.a0)}–${m2(o.a1)} м вдоль стены, ${m2(o.bottom)}–${m2(o.top)} м по высоте`, badge: o.state === 'closed' ? 'Закрыто' : o.state === 'open' ? 'Открыто' : o.state === 'permanent' ? 'Проём' : 'Неизвестно',
  }));
  const add = (kind: 'door' | 'window' | 'passage') => { const id = clock.newId(); void edit.apply((x) => upsertOpening(x, newOpening(x, kind, wall, id)), OPENING_KIND[kind]); };
  return (
    <div class="al-stack al-stack--24">
      <Card title="Размеры" subtitle={`${c.shape ? 'Основная часть комнаты сложной формы; части — в «Форме комнаты».' : 'Прямоугольная комната.'} Пока места не выбраны, колонки и слушатель встают на исходные места для новых размеров.`}>
        <div class="al-grid">
          {(['depth', 'width', 'height'] as const).map((k) => (
            <NumberField key={k} label={`${DIM_LABEL[k]}${k === 'depth' ? ' (от передней стены к задней)' : k === 'width' ? ' (вдоль передней стены)' : ''}`} unit="м" value={g[k]} min={DIM_LIMITS[k][0]} max={DIM_LIMITS[k][1]} onCommit={dim(k)} />
          ))}
        </div>
      </Card>
      {visibleAt('advanced', level) ? <ShapeCard edit={edit} /> : c.shape && <Notice>Комната сложной формы: частей — {c.shape.zoneIds.length}. Форма редактируется на продвинутом уровне.</Notice>}
      <ScanCard edit={edit} />
      {visibleAt('advanced', level) && <SlopeCard edit={edit} />}
      <Card title="Поверхности" subtitle="Материал задаёт поглощение по октавам; ковры, шторы и обработка добавляются поверх.">
        <div class="al-grid">
          {SURFACES.map((s) => <SurfaceField key={s} c={c} s={s} edit={edit} materials={materials} />)}
        </div>
      </Card>
      <Card title="Двери, окна и проёмы" subtitle="Закрытые двери и окна учитываются как часть стены, открытые и постоянные проёмы — как выход звука из комнаты.">
        <div class="al-stack al-stack--16">
          <div class="al-row al-row--12 al-row--bottom">
            <SelectField label="Стена для нового" value={wall} onChange={setWall} options={wallOptions} compact />
            <Button small icon="door" onClick={() => add('door')}>Дверь</Button>
            <Button small icon="window" onClick={() => add('window')}>Окно</Button>
            <Button small onClick={() => add('passage')}>Проём</Button>
          </div>
          <ObjectList label="Двери, окна и проёмы" rows={rows} edit={edit} level={level} empty="Проёмов нет." />
        </div>
      </Card>
      {visibleAt('advanced', level) ? <ZonesCard edit={edit} /> : c.zones.length > 0 && <Notice>Смежных зон: {c.zones.length}. Они редактируются на продвинутом уровне.</Notice>}
    </div>
  );
}

function SlopeCard({ edit }: { edit: ConfigEdit }) {
  const c = edit.config;
  const g = c.geometry as Extract<RoomConfiguration['geometry'], { kind: 'rect' }>;
  const s = g.slope;
  const set = (next: typeof s) => edit.apply((x) => setSlope(x, next), 'Скос потолка');
  const across = (w: WallId) => (w === 'front' || w === 'back' ? g.depth : g.width);
  return (
    <Card title="Скос потолка" subtitle="Потолок понижается к одной стене: высота у стены и ширина скоса.">
      <div class="al-stack al-stack--12">
        <Switch label="Есть скос" checked={!!s} onChange={(v) => set(v ? { wall: 'front', low: Math.max(0.5, Math.round((g.height - 0.6) * 100) / 100), run: Math.min(1.5, across('front')) } : null)} />
        {s && (
          <div class="al-grid">
            <SelectField label="Стена" value={s.wall} onChange={(w) => set({ ...s, wall: w, run: Math.min(s.run, across(w)) })} options={wallOptions} />
            <NumberField label="Высота у стены" unit="м" value={s.low} min={0.5} max={g.height - 0.01} onCommit={(v) => set({ ...s, low: v })} />
            <NumberField label="Ширина скоса" unit="м" value={s.run} min={0.21} max={across(s.wall)} onCommit={(v) => set({ ...s, run: v })} />
          </div>
        )}
      </div>
    </Card>
  );
}

function ZonesCard({ edit }: { edit: ConfigEdit }) {
  const { clock } = useApp();
  const c = edit.config;
  const g = c.geometry as Extract<RoomConfiguration['geometry'], { kind: 'rect' }>;
  const [open, setOpen] = useState<string | null>(null);
  const add = () => { const id = clock.newId(); void edit.apply((x) => upsertZone(x, newZone(x, 'back', id, `Зона ${x.zones.length + 1}`)), 'Смежная зона').then((ok) => ok && setOpen(id)); };
  return (
    <Card title="Смежные зоны" subtitle="Коридор или ниша за проёмом в стене: учитываются волновой моделью баса." actions={<Button small icon="plus" onClick={add}>Добавить</Button>}>
      {c.zones.length === 0 ? <p class="al-text-small al-text-secondary">Смежных зон нет.</p> : (
        <div class="al-stack al-stack--16">
          {c.zones.map((z) => (
            <div key={z.id} class="al-stack al-stack--12">
              <div class="al-row al-row--between">
                <span class="al-row"><span class="al-text-title">{z.name}</span>{c.shape?.zoneIds.includes(z.id) && <Badge>Часть формы</Badge>}{z.fromScan && <Badge>Из скана</Badge>}</span>
                <div class="al-row">
                  <Button variant="ghost" small onClick={() => setOpen(open === z.id ? null : z.id)} aria-expanded={open === z.id}>{open === z.id ? 'Свернуть' : 'Изменить'}</Button>
                  <Button variant="danger-ghost" small icon="trash" onClick={() => edit.apply((x) => removeZone(x, z.id), 'Удаление зоны')}>Удалить</Button>
                </div>
              </div>
              <p class="al-text-small al-text-secondary">{WALL_LABEL[z.wall]} стена, {m2(z.a0)}–{m2(z.a1)} м; глубина {m2(z.depth)} м, высота {m2(z.height)} м; арка {m2(z.arch.a0)}–{m2(z.arch.a1)} м высотой {m2(z.arch.height)} м</p>
              {open === z.id && <ZoneFields z={z} roomHeight={g.height} onSave={(next) => edit.apply((x) => upsertZone(x, next), 'Смежная зона')} />}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function ZoneFields({ z, roomHeight, onSave }: { z: Extension; roomHeight: number; onSave: (z: Extension) => void }) {
  const set = (patch: Partial<Extension>) => onSave({ ...z, ...patch });
  const arch = (patch: Partial<Extension['arch']>) => onSave({ ...z, arch: { ...z.arch, ...patch } });
  return (
    <div class="al-stack al-stack--12">
      <div class="al-grid">
        <NameField value={z.name} onCommit={(v) => set({ name: v })} />
        <SelectField label="Стена" value={z.wall} onChange={(w) => set({ wall: w })} options={wallOptions} />
        <NumberField label="Начало вдоль стены" unit="м" value={z.a0} onCommit={(v) => set({ a0: v })} />
        <NumberField label="Конец вдоль стены" unit="м" value={z.a1} onCommit={(v) => set({ a1: v })} />
        <NumberField label="Глубина" unit="м" value={z.depth} min={0.3} max={20} onCommit={(v) => set({ depth: v })} />
        <NumberField label="Высота" unit="м" value={z.height} min={1} max={20} onCommit={(v) => set({ height: v })} />
        <NumberField label="Арка: начало" unit="м" value={z.arch.a0} onCommit={(v) => arch({ a0: v })} />
        <NumberField label="Арка: конец" unit="м" value={z.arch.a1} onCommit={(v) => arch({ a1: v })} />
        <NumberField label="Арка: высота" unit="м" value={z.arch.height} min={0.51} max={roomHeight} onCommit={(v) => arch({ height: v })} />
      </div>
      <div class="al-row al-row--16">
        <Switch label="Открыт конец у начала" checked={z.openStart} onChange={(v) => set({ openStart: v })} />
        <Switch label="Открыт конец у конца" checked={z.openEnd} onChange={(v) => set({ openEnd: v })} />
        <Switch label="Открыта дальняя сторона" checked={z.openFar} onChange={(v) => set({ openFar: v })} />
      </div>
    </div>
  );
}

// ---------- Аудиосистема ----------

export function AudioSection({ edit, level }: SectionProps) {
  const c = edit.config;
  const subs = c.audio.sources.filter((s) => s.kind === 'sub');
  const rows: Row[] = c.audio.sources.map((s) => ({
    ref: { type: 'source', id: s.id }, title: s.name,
    meta: `${s.kind === 'sub' ? 'Сабвуфер' : 'Колонка'} · x ${m2(s.position.x)}, y ${m2(s.position.y)}, высота ${m2(s.position.z)} м · ${s.fLow}–${s.fHigh} Гц`,
    badge: s.locked ? 'Закреплён' : s.channel,
  }));
  const layout = c.audio.layout === 'custom' ? null : c.audio.layout;
  const xo = c.audio.crossover;
  return (
    <div class="al-stack al-stack--24">
      <Card title="Схема системы" subtitle={c.audio.layout === 'custom' ? 'Произвольная схема: состав изменён вручную.' : `Стандартная схема ${c.audio.layout === 'mono' ? '1.0' : c.audio.layout}.`}>
        <div class="al-stack al-stack--12">
          <SegmentedControl label="Стандартная схема" value={layout ?? ('' as Exclude<SystemLayout, 'custom'>)} onChange={(v) => edit.apply((x) => setLayout(x, v), `Схема ${v}`)} options={LAYOUT_OPTIONS} />
          <p class="al-text-small al-text-secondary">Смена схемы сохраняет стоящие источники вместе с местами и настройками; новые встают на исходные места. Сабвуферов может быть больше двух — добавьте их вручную.</p>
          <div class="al-row">
            <Button small icon="speaker" onClick={() => edit.apply((x) => addSource(x, 'speaker'), 'Новая колонка')}>Добавить колонку</Button>
            <Button small icon="sub" onClick={() => edit.apply((x) => addSource(x, 'sub'), 'Новый сабвуфер')}>Добавить сабвуфер</Button>
          </div>
        </div>
      </Card>
      <Card title="Источники">
        <ObjectList label="Источники" rows={rows} edit={edit} level={level} empty="Источников нет: выберите схему или добавьте колонку." />
      </Card>
      {subs.length > 0 && (
        <Card title="Раздел с сабвуфером">
          <div class="al-stack al-stack--12">
            <NumberField label="Частота раздела" unit="Гц" decimals={0} optional value={c.audio.crossoverHz} min={30} max={250} hint="Пусто — по диапазонам источников"
              onCommit={(v) => edit.apply((x) => ({ ...x, audio: { ...x.audio, crossoverHz: Number.isFinite(v) ? v : null } }), 'Частота раздела')} />
            {visibleAt('advanced', level) && (
              <>
                <Switch label="Частоту раздела можно менять при подборе" checked={xo.adjustable} onChange={(v) => edit.apply((x) => ({ ...x, audio: { ...x.audio, crossover: { ...x.audio.crossover, adjustable: v } } }), 'Раздел')} />
                {xo.adjustable && (
                  <div class="al-grid">
                    <NumberField label="От" unit="Гц" decimals={0} value={xo.min} min={20} max={xo.max} onCommit={(v) => edit.apply((x) => ({ ...x, audio: { ...x.audio, crossover: { ...x.audio.crossover, min: v } } }), 'Раздел')} />
                    <NumberField label="До" unit="Гц" decimals={0} value={xo.max} min={xo.min} max={300} onCommit={(v) => edit.apply((x) => ({ ...x, audio: { ...x.audio, crossover: { ...x.audio.crossover, max: v } } }), 'Раздел')} />
                  </div>
                )}
                <Switch label="Добавить к вариантам схему DBA" hint="Нужно не меньше двух сабвуферов" disabled={subs.length < 2} checked={!!c.simulation.placement.dba}
                  onChange={(v) => edit.apply((x) => ({ ...x, simulation: { ...x.simulation, placement: { ...x.simulation.placement, dba: v } } }), 'Схема DBA')} />
              </>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------- Слушатели ----------

export function ListeningSection({ edit, level }: SectionProps) {
  const { clock } = useApp();
  const c = edit.config;
  const rows: Row[] = c.listening.listeners.map((l) => ({
    ref: { type: 'listener', id: l.id }, title: l.name, meta: `x ${m2(l.position.x)}, y ${m2(l.position.y)} м · уши на ${m2(l.position.z)} м`,
    badge: l.primary ? 'Основное' : l.locked ? 'Закреплено' : undefined,
  }));
  const seats = c.listening.seats;
  const pl = c.simulation.placement;
  const depth = c.geometry.kind === 'rect' ? c.geometry.depth : 50;
  const setSeats = (patch: Partial<typeof seats>) => edit.apply((x) => ({ ...x, listening: { ...x.listening, seats: { ...x.listening.seats, ...patch } } }), 'Ряд мест');
  const setZone = (patch: Partial<typeof pl>) => edit.apply((x) => ({ ...x, simulation: { ...x.simulation, placement: { ...x.simulation.placement, ...patch } } }), 'Область прослушивания');
  return (
    <div class="al-stack al-stack--24">
      <Card title="Места прослушивания" subtitle="Слушатель — отдельный объект, даже если сидит на диване или в кресле. Основное место — опора расчёта." actions={<Button small icon="plus" onClick={() => edit.apply((x) => addListener(x, clock.newId), 'Новое место')}>Добавить место</Button>}>
        <ObjectList label="Места прослушивания" rows={rows} edit={edit} level={level} empty="Мест нет." />
      </Card>
      <Card title="Ряд мест вокруг основного" subtitle="Расчёт оценивает ровность баса и на соседних местах ряда.">
        <div class="al-grid">
          <NumberField label="Мест в ряду" unit="шт." decimals={0} value={seats.count} min={1} max={7} onCommit={(v) => setSeats({ count: Math.round(v) })} />
          <NumberField label="Шаг между местами" unit="м" value={seats.spacing} min={0.3} max={1.5} onCommit={(v) => setSeats({ spacing: v })} />
        </div>
      </Card>
      {visibleAt('advanced', level) && (
        <Card title="Область поиска места" subtitle="Где подбор может предлагать основное место (расстояние от передней стены).">
          <div class="al-grid">
            <NumberField label="Не ближе" unit="м" value={pl.listenerMinX} min={0} max={pl.listenerMaxX} onCommit={(v) => setZone({ listenerMinX: v })} />
            <NumberField label="Не дальше" unit="м" value={pl.listenerMaxX} min={pl.listenerMinX} max={depth} onCommit={(v) => setZone({ listenerMaxX: v })} />
          </div>
        </Card>
      )}
    </div>
  );
}

// ---------- Интерьер ----------

export function InteriorSection({ edit, level }: SectionProps) {
  const { clock } = useApp();
  const c = edit.config;
  const [type, setType] = useState<(typeof FURNITURE_ORDER)[number]>('sofa');
  const [wall, setWall] = useState<WallId>('back');
  const rows: Row[] = [
    ...c.interior.obstacles.map((z): Row => ({
      ref: { type: 'obstacle', id: z.id }, title: z.name ?? 'Предмет', meta: `${m2(z.x1 - z.x0)} × ${m2(z.y1 - z.y0)} м${z.height ? `, высота ${m2(z.height)} м` : ''}${z.canSit ? ' · можно сидеть' : ''}`,
      badge: z.locked ? 'Закреплён' : undefined,
    })),
    ...c.interior.coverings.map((cv): Row => ({
      ref: { type: 'covering', id: cv.id }, title: cv.kind === 'curtain' ? 'Шторы' : cv.surface === 'floor' ? 'Ковёр на полу' : 'Ковёр на стене',
      meta: `${cv.surface === 'floor' ? 'Пол' : `${WALL_LABEL[cv.surface]} стена`} · ${m2(cv.u1 - cv.u0)} × ${m2(cv.v1 - cv.v0)} м`,
    })),
  ];
  return (
    <div class="al-stack al-stack--24">
      <Card title="Обстановка" subtitle="Общий уровень мебели задаёт поглощение на басу; список предметов уточняет средние и высокие частоты.">
        <div class="al-stack al-stack--12">
          <SelectField<Furnishing> label="Меблировка" value={c.interior.furnishing} onChange={(v) => edit.apply((x) => ({ ...x, interior: { ...x.interior, furnishing: v } }), 'Меблировка')}
            options={(Object.keys(FURNISHING_LABEL) as Furnishing[]).map((k) => ({ value: k, label: FURNISHING_LABEL[k] }))} />
          <Switch label="Учитывать список мебели и покрытий" hint="Ковры и шторы поглощают звук только при включённом списке" checked={c.interior.furnitureList}
            onChange={(v) => edit.apply((x) => ({ ...x, interior: { ...x.interior, furnitureList: v } }), 'Список мебели')} />
        </div>
      </Card>
      <Card title="Предметы и покрытия">
        <div class="al-stack al-stack--16">
          <div class="al-row al-row--12 al-row--bottom">
            <SelectField label="Предмет" value={type} onChange={setType} options={FURNITURE_ORDER.map((t) => ({ value: t, label: FURNITURE_LABEL[t] }))} compact />
            <Button small icon="plus" onClick={() => { const id = clock.newId(); void edit.apply((x) => addFurniture(x, type, id), FURNITURE_LABEL[type]); }}>Добавить предмет</Button>
            <Button small icon="plus" onClick={() => { const id = clock.newId(); void edit.apply((x) => addCovering(x, 'rug', id), 'Ковёр'); }}>Ковёр на полу</Button>
          </div>
          <div class="al-row al-row--12 al-row--bottom">
            <SelectField label="Стена" value={wall} onChange={setWall} options={wallOptions} compact />
            <Button small icon="plus" onClick={() => { const id = clock.newId(); void edit.apply((x) => addCovering(x, 'curtain', id, wall), 'Шторы'); }}>Шторы</Button>
            <Button small icon="plus" onClick={() => { const id = clock.newId(); void edit.apply((x) => addCovering(x, 'wall-carpet', id, wall), 'Ковёр на стене'); }}>Ковёр на стене</Button>
          </div>
          <ObjectList label="Предметы и покрытия" rows={rows} edit={edit} level={level} empty="Предметов нет." />
        </div>
      </Card>
    </div>
  );
}

// ---------- Обработка ----------

export function TreatmentSection({ edit, level }: SectionProps) {
  const { clock } = useApp();
  const c = edit.config;
  const rows: Row[] = c.treatment.items.map((t) => ({
    ref: { type: 'treatment', id: t.id }, title: TREATMENT_LABEL[t.kind],
    meta: t.kind === 'corner' ? `${CORNER_LABEL[t.corner ?? 'front-left']} угол · фасад ${m2(t.width)} м` : t.kind === 'cloud' ? `${m2(t.width)} × ${m2(t.height)} м под потолком`
      : `${WALL_LABEL[t.wall!]} стена · ${m2(t.width)} × ${m2(t.height)} м`,
    badge: t.enabled === false ? 'Не учитывается' : t.kind === 'diffuser' || t.kind === 'resonator' ? 'Вне расчёта' : undefined,
  }));
  return (
    <div class="al-stack al-stack--24">
      <Card title="Акустическая обработка" subtitle="Пять видов: панели на стенах, угловые ловушки, потолочные облака, диффузоры и резонаторы.">
        <div class="al-stack al-stack--12">
          <Switch label="Учитывать обработку в расчёте" checked={c.treatment.enabled} onChange={(v) => edit.apply((x) => ({ ...x, treatment: { ...x.treatment, enabled: v } }), v ? 'Обработка включена' : 'Обработка выключена')} />
          <div class="al-row">
            {(Object.keys(TREATMENT_LABEL) as TreatmentKind[]).map((k) => (
              <Button key={k} small icon="plus" onClick={() => { const id = clock.newId(); void edit.apply((x) => addTreatment(x, newTreatment(x, k, id)), TREATMENT_LABEL[k]); }}>{TREATMENT_LABEL[k]}</Button>
            ))}
          </div>
          <p class="al-text-small al-text-secondary">Пористые элементы считаются ядром (поглощение по толщине и зазору). Диффузоры и резонаторы сохраняются в модели и видны на плане, но в расчёт пока не входят.</p>
        </div>
      </Card>
      <Card title="Элементы">
        <ObjectList label="Элементы обработки" rows={rows} edit={edit} level={level} empty="Элементов нет." />
      </Card>
    </div>
  );
}

// ---------- Параметры расчёта ----------

export function SimulationSection({ edit, level }: SectionProps) {
  const c = edit.config;
  const sp = c.simulation;
  const pl = sp.placement;
  const set = (patch: Partial<RoomConfiguration['simulation']>, label: string) => edit.apply((x) => ({ ...x, simulation: { ...x.simulation, ...patch } }), label);
  const setPl = (patch: Partial<typeof pl>, label: string) => edit.apply((x) => ({ ...x, simulation: { ...x.simulation, placement: { ...x.simulation.placement, ...patch } } }), label);
  return (
    <div class="al-stack al-stack--24">
      <HiddenNotice edit={edit} level={level} />
      {!visibleAt('advanced', level) && <Notice>На простом уровне расчёт использует значения по умолчанию. Параметры открываются на продвинутом и экспертном уровнях (Настройки).</Notice>}
      {visibleAt('advanced', level) && (
        <Card title="Условия" subtitle="Влияют на скорость звука и самый низкий бас.">
          <div class="al-grid">
            <NumberField label="Температура воздуха" unit="°C" decimals={1} value={sp.temperatureC} min={-10} max={45} onCommit={(v) => set({ temperatureC: v }, 'Температура')} />
            <SelectField<Leakage> label="Герметичность комнаты" hint="Через щели и открытые двери давление «утекает» ниже первой моды" value={sp.leakage} onChange={(v) => set({ leakage: v }, 'Герметичность')}
              options={(Object.keys(LEAKAGE_LABEL) as Leakage[]).map((k) => ({ value: k, label: LEAKAGE_LABEL[k] }))} />
          </div>
        </Card>
      )}
      {visibleAt('advanced', level) && (
        <Card title="Правила расстановки" subtitle="Ограничения для подбора и проверки мест.">
          <div class="al-grid">
            <NumberField label="Колонки от передней стены не ближе" unit="м" value={pl.speakerMinFront} min={0} max={3} onCommit={(v) => setPl({ speakerMinFront: v }, 'Правила расстановки')} />
            <NumberField label="Колонки от боковых стен не ближе" unit="м" value={pl.speakerMinSide} min={0} max={3} onCommit={(v) => setPl({ speakerMinSide: v }, 'Правила расстановки')} />
            <SelectField<SubZone> label="Где может стоять сабвуфер" value={pl.subZone} onChange={(v) => setPl({ subZone: v }, 'Правила расстановки')} options={(Object.keys(SUBZONE_LABEL) as SubZone[]).map((k) => ({ value: k, label: SUBZONE_LABEL[k] }))} />
            <NumberField label="Зазор сабвуфера до стены" unit="м" value={pl.subWallGap} min={0} max={1} onCommit={(v) => setPl({ subWallGap: v }, 'Правила расстановки')} />
          </div>
        </Card>
      )}
      {visibleAt('expert', level) && (
        <Card title="Модель и точность">
          <div class="al-stack al-stack--12">
            <div class="al-grid">
              <SelectField<AcousticModel> label="Модель расчёта баса" hint="Авто: волновая при смежных зонах, иначе прямоугольная" value={sp.model} onChange={(v) => set({ model: v }, 'Модель расчёта')}
                options={(Object.keys(MODEL_LABEL) as AcousticModel[]).map((k) => ({ value: k, label: MODEL_LABEL[k] }))} />
              <SelectField<Precision> label="Точность расчёта" value={sp.precision ?? 'standard'} onChange={(v) => set({ precision: v === 'standard' ? undefined : v }, 'Точность')}
                options={PRECISIONS.map((k) => ({ value: k, label: PRECISION_LABEL[k] }))} />
            </div>
            {sp.calibration
              ? <Notice title="Модель подстроена по замеру" action={<Button small onClick={() => edit.apply(resetCalibration, 'Сброс подстройки')}>Сбросить подстройку</Button>}>Подстройка получена из измерения и меняет поглощение модели; сброс возвращает и прежнюю герметичность. Новая подстройка делается в разделе анализа «Измерения».</Notice>
              : <p class="al-text-small al-text-secondary">Подстройки по замеру нет.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}

/** Уведомление о скрытых уровнем параметрах, отличных от значений по умолчанию (spec §2). */
export function HiddenNotice({ edit, level }: { edit: ConfigEdit; level: Complexity }) {
  const hidden = hiddenOverrides(edit.config, level);
  if (!hidden.length) return null;
  return (
    <Notice tone="warning" title="Скрытые параметры изменены" action={<Button small onClick={() => edit.apply((x) => resetParams(x, hidden.map((p) => p.id)), 'Сброс скрытых параметров')}>Сбросить к значениям по умолчанию</Button>}>
      Расчёт использует значения, которые на этом уровне не показываются: {hidden.map((p) => p.label.toLowerCase()).join(', ')}. Они сохранены; увидеть их можно на более сложном уровне.
    </Notice>
  );
}
