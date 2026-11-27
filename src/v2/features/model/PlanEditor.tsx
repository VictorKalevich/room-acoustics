// Единый план комнаты (V2-024, V2-025): виды сверху, сбоку и спереди, слои, привязка к сетке, добавление объектов,
// перетаскивание с предпросмотром без записи, свойства выбранного объекта, отмена и повтор, проверка расстановки.
import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Checkbox, IconButton, Notice, PlanLegend, PlanView, SegmentedControl, SelectField, Sheet, Switch, type PlanViewKind } from '../../design-system';
import { FURNITURE_ORDER } from '../../../core/furniture';
import type { WallId } from '../../../core/types';
import {
  FURNITURE_LABEL, addCovering, addFurniture, addListener, addSource, addTreatment, moveRef, moveSymmetric, newOpening, newTreatment, placementIssues, upsertOpening,
  type EditRef, type TreatmentKind,
} from '../../application/editing';
import type { Complexity, RoomConfiguration } from '../../domain/model';
import { useApp } from '../../shared/context';
import type { RoomHandle } from '../rooms/useRoom';
import { LAYERS, LAYER_LABEL, planId, planItems, refOf, type Layer } from './planItems';
import { Properties } from './Properties';
import type { ConfigEdit } from './useConfig';

const VIEWS = [{ value: 'top', label: 'Сверху' }, { value: 'side', label: 'Сбоку' }, { value: 'front', label: 'Спереди' }] as const;
const SNAPS = [{ value: '0', label: 'Без привязки' }, { value: '0.05', label: '5 см' }, { value: '0.1', label: '10 см' }, { value: '0.25', label: '25 см' }, { value: '0.5', label: '50 см' }];
const WALL_OPTIONS: { value: WallId; label: string }[] = [
  { value: 'front', label: 'Передняя' }, { value: 'back', label: 'Задняя' }, { value: 'left', label: 'Левая' }, { value: 'right', label: 'Правая' },
];

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function PlanEditor({ h, edit, level }: { h: RoomHandle; edit: ConfigEdit; level: Complexity }) {
  const c = edit.config;
  const [view, setView] = useState<PlanViewKind>('top');
  const [layers, setLayers] = useState<ReadonlySet<Layer>>(() => new Set(LAYERS));
  const [snapStep, setSnapStep] = useState('0.05');
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [symmetric, setSymmetric] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || typing(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey && h.canUndo) { e.preventDefault(); void h.undo(); }
      else if ((k === 'y' || (k === 'z' && e.shiftKey)) && h.canRedo) { e.preventDefault(); void h.redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [h]);

  if (c.geometry.kind !== 'rect') return <Notice tone="warning" title="План недоступен">Редактор плана работает с прямоугольной комнатой (со скосом потолка и смежными зонами).</Notice>;
  const g = c.geometry;
  const { items, openings } = planItems(c, layers);
  const ref = selected ? refOf(selected) : null;
  const shown = ref && exists(c, ref) ? ref : null;
  const issues = placementIssues(c);
  const step = Number(snapStep);

  const onMove = (id: string, to: { x?: number; y?: number; z?: number }, final: boolean) => {
    const r = refOf(id);
    if (!r) return;
    const move = symmetric ? moveSymmetric : moveRef;
    if (final) void edit.apply((x) => move(x, r, to), symmetric ? 'Симметричное перемещение' : 'Перемещение');
    else edit.preview((x) => move(x, r, to));
  };
  const toggle = (l: Layer, on: boolean) => setLayers((s) => { const n = new Set(s); if (on) n.add(l); else n.delete(l); return n; });
  const added = async (op: (x: RoomConfiguration) => RoomConfiguration, label: string, pick: (x: RoomConfiguration) => EditRef | null) => {
    setAdding(false);
    const out: { config: RoomConfiguration | null } = { config: null };
    const ok = await edit.apply((x) => (out.config = op(x)), label);
    const r = ok && out.config ? pick(out.config) : null;
    if (r) { setSelected(planId(r)); setLayers((s) => new Set([...s, layerOf(r)])); }
  };

  return (
    <div class="al-stack al-stack--16">
      <div class="al-row al-row--12 al-row--between">
        <SegmentedControl label="Вид плана" value={view} onChange={setView} options={VIEWS} />
        <div class="al-row">
          <IconButton icon="undo" label={h.undoLabel ? `Отменить: ${h.undoLabel}` : 'Отменить'} disabled={!h.canUndo} onClick={() => void h.undo()} />
          <IconButton icon="redo" label={h.redoLabel ? `Повторить: ${h.redoLabel}` : 'Повторить'} disabled={!h.canRedo} onClick={() => void h.redo()} />
          <Button icon="plus" variant="primary" small onClick={() => setAdding(true)}>Добавить</Button>
        </div>
      </div>
      <div class="al-split">
        <div class="al-stack al-stack--12">
          <PlanView
            title="План комнаты" depth={g.depth} width={g.width} height={g.height} view={view} items={items} openings={openings}
            selectedId={shown ? planId(shown) : null} onSelect={setSelected} onMove={onMove} snapStep={step} gridStep={step >= 0.25 ? step : 0.5}
          />
          <PlanLegend types={['source', 'listener', 'interior', 'absorber', 'bass-trap', 'diffuser']} />
          <p class="al-text-small al-text-secondary">Объект выбирается касанием или клавишей Tab, перемещается перетаскиванием или стрелками (Shift — шаг 25 см). Ctrl+Z — отменить, Ctrl+Y — повторить.</p>
        </div>
        <div class="al-split__aside">
          {shown
            ? <Properties edit={edit} refx={shown} level={level} onClose={() => setSelected(null)} />
            : (
              <Card title="Слои и привязка">
                <div class="al-stack al-stack--12">
                  <div class="al-stack al-stack--8" role="group" aria-label="Слои плана">
                    {LAYERS.map((l) => <Checkbox key={l} label={LAYER_LABEL[l]} checked={layers.has(l)} onChange={(v) => toggle(l, v)} />)}
                  </div>
                  <SelectField label="Привязка при перетаскивании" value={snapStep} onChange={setSnapStep} options={SNAPS} />
                  <Switch label="Симметрично для пары колонок" hint="L и R, SL и SR двигаются зеркально относительно середины комнаты" checked={symmetric} onChange={setSymmetric} />
                  <p class="al-text-small al-text-secondary">Выберите объект на плане, чтобы ввести точные координаты, размеры и параметры.</p>
                </div>
              </Card>
            )}
          {issues.length > 0 && (
            <Notice tone="warning" title={`Проверка расстановки: ${issues.length}`}>
              <ul class="al-stack al-stack--8" aria-label="Замечания к расстановке">
                {issues.map((i) => {
                  const r = refOf(i.path);
                  return (
                    <li key={`${i.path}:${i.message}`} class="al-row al-row--between">
                      <span>{i.message}</span>
                      {r && <Button variant="ghost" small onClick={() => { setSelected(planId(r)); setLayers((s) => new Set([...s, layerOf(r)])); }}>Выбрать</Button>}
                    </li>
                  );
                })}
              </ul>
            </Notice>
          )}
        </div>
      </div>
      {adding && <AddSheet c={c} onClose={() => setAdding(false)} onAdd={added} />}
    </div>
  );
}

function exists(c: RoomConfiguration, r: EditRef): boolean {
  const list: { id: string }[] = r.type === 'source' ? c.audio.sources : r.type === 'listener' ? c.listening.listeners : r.type === 'obstacle' ? c.interior.obstacles
    : r.type === 'treatment' ? c.treatment.items : r.type === 'covering' ? c.interior.coverings : c.openings;
  return list.some((x) => x.id === r.id);
}

function layerOf(r: EditRef): Layer {
  return r.type === 'source' ? 'audio' : r.type === 'listener' ? 'listeners' : r.type === 'obstacle' || r.type === 'covering' ? 'interior' : r.type === 'treatment' ? 'treatment' : 'openings';
}

type AddFn = (op: (x: RoomConfiguration) => RoomConfiguration, label: string, pick: (x: RoomConfiguration) => EditRef | null) => void;

const TREATMENT_ADD: { kind: TreatmentKind; label: string }[] = [
  { kind: 'panel', label: 'Панель на стене' }, { kind: 'corner', label: 'Угловая ловушка' }, { kind: 'cloud', label: 'Потолочное облако' },
  { kind: 'diffuser', label: 'Диффузор' }, { kind: 'resonator', label: 'Резонатор' },
];

function AddSheet({ c, onClose, onAdd }: { c: RoomConfiguration; onClose: () => void; onAdd: AddFn }) {
  const { clock } = useApp();
  const [wall, setWall] = useState<WallId>('back');
  const last = <T extends { id: string }>(xs: T[]) => xs.at(-1)?.id ?? null;
  const ref = (type: EditRef['type'], id: string | null): EditRef | null => (id ? ({ type, id } as EditRef) : null);
  const subs = c.audio.sources.filter((s) => s.kind === 'sub').length;
  return (
    <Sheet title="Добавить на план" onClose={onClose}>
      <div class="al-stack al-stack--16">
        <section class="al-stack al-stack--8" aria-label="Аудиосистема">
          <h3 class="al-text-overline">Аудиосистема</h3>
          <div class="al-row">
            <Button icon="speaker" small onClick={() => onAdd((x) => addSource(x, 'speaker'), 'Новая колонка', (x) => ref('source', last(x.audio.sources)))}>Колонка</Button>
            <Button icon="sub" small onClick={() => onAdd((x) => addSource(x, 'sub'), 'Новый сабвуфер', (x) => ref('source', last(x.audio.sources)))}>Сабвуфер{subs ? ` (${subs + 1}-й)` : ''}</Button>
            <Button icon="listener" small onClick={() => onAdd((x) => addListener(x, clock.newId), 'Новое место', (x) => ref('listener', last(x.listening.listeners)))}>Место прослушивания</Button>
          </div>
        </section>
        <section class="al-stack al-stack--8" aria-label="Интерьер">
          <h3 class="al-text-overline">Интерьер</h3>
          <div class="al-row">
            {FURNITURE_ORDER.map((t) => (
              <Button key={t} small onClick={() => { const id = clock.newId(); onAdd((x) => addFurniture(x, t, id), FURNITURE_LABEL[t], () => ref('obstacle', id)); }}>{FURNITURE_LABEL[t]}</Button>
            ))}
            <Button small onClick={() => { const id = clock.newId(); onAdd((x) => addCovering(x, 'rug', id), 'Ковёр', () => ref('covering', id)); }}>Ковёр на полу</Button>
          </div>
        </section>
        <section class="al-stack al-stack--8" aria-label="Обработка">
          <h3 class="al-text-overline">Обработка</h3>
          <div class="al-row">
            {TREATMENT_ADD.map((t) => (
              <Button key={t.kind} icon="panel" small onClick={() => { const id = clock.newId(); onAdd((x) => addTreatment(x, newTreatment(x, t.kind, id)), t.label, () => ref('treatment', id)); }}>{t.label}</Button>
            ))}
          </div>
        </section>
        <section class="al-stack al-stack--8" aria-label="На стене">
          <h3 class="al-text-overline">На стене</h3>
          <SelectField label="Стена" value={wall} onChange={setWall} options={WALL_OPTIONS} />
          <div class="al-row">
            <Button icon="door" small onClick={() => { const id = clock.newId(); onAdd((x) => upsertOpening(x, newOpening(x, 'door', wall, id)), 'Дверь', () => ref('opening', id)); }}>Дверь</Button>
            <Button icon="window" small onClick={() => { const id = clock.newId(); onAdd((x) => upsertOpening(x, newOpening(x, 'window', wall, id)), 'Окно', () => ref('opening', id)); }}>Окно</Button>
            <Button small onClick={() => { const id = clock.newId(); onAdd((x) => upsertOpening(x, newOpening(x, 'passage', wall, id)), 'Проём', () => ref('opening', id)); }}>Проём</Button>
            <Button small onClick={() => { const id = clock.newId(); onAdd((x) => addCovering(x, 'curtain', id, wall), 'Шторы', () => ref('covering', id)); }}>Шторы</Button>
            <Button small onClick={() => { const id = clock.newId(); onAdd((x) => addCovering(x, 'wall-carpet', id, wall), 'Ковёр на стене', () => ref('covering', id)); }}>Ковёр на стене</Button>
          </div>
        </section>
      </div>
    </Sheet>
  );
}
