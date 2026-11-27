// Форма комнаты (V2-046, продвинутый уровень): шаблон или точки контура → предпросмотр на плане → применение к
// выбранной конфигурации с отменой. Части формы — смежные зоны ядра; их считает волновая модель.
import { useState } from 'preact/hooks';
import { Button, Card, NumberField, Notice, PlanView, SelectField, TextField, useToast, type PlanAnnex } from '../../design-system';
import { WALL_LABEL } from '../../application/editing';
import { SHAPE_LABEL, applyShape, decomposeContour, parseOutline, shapeSize, sideLabel, templateShape, type Pt, type ShapeDraft, type ShapeResult, type TemplateParams } from '../../application/shapes';
import type { RectGeometry, ShapeKind } from '../../domain/model';
import type { WallId } from '../../../core/types';
import { DIM_LIMITS } from '../../domain/validation';
import { useApp } from '../../shared/context';
import type { ConfigEdit } from './useConfig';

const KINDS: ShapeKind[] = ['rect', 'l', 't', 'u', 'niche', 'contour'];
const WALLS: WallId[] = ['back', 'front', 'left', 'right'];
const n2 = (v: number) => (Math.round(v * 100) / 100).toString().replace('.', ',');
const outlineText = (pts: Pt[]) => pts.map((p) => `${n2(p.x)}; ${n2(p.y)}`).join('\n');

/** Части черновика — пристройки для предпросмотра. */
function draftAnnexes(d: ShapeDraft): PlanAnnex[] {
  return d.wings.map((w, k) => {
    const [x0, x1, y0, y1] = w.wall === 'right' ? [w.a0, w.a1, d.width, d.width + w.depth] : w.wall === 'left' ? [w.a0, w.a1, -w.depth, 0]
      : w.wall === 'front' ? [-w.depth, 0, w.a0, w.a1] : [d.depth, d.depth + w.depth, w.a0, w.a1];
    return { id: `draft-${k}`, x0, x1, y0, y1, height: w.height ?? d.height, wall: w.wall, a0: w.a0, a1: w.a1, label: `Часть ${k + 1}`, part: true };
  });
}

export function ShapeCard({ edit }: { edit: ConfigEdit }) {
  const { clock } = useApp();
  const toast = useToast();
  const c = edit.config;
  const g = c.geometry as RectGeometry;
  const [kind, setKind] = useState<ShapeKind>(c.shape?.kind ?? 'rect');
  const [p, setP] = useState<Omit<TemplateParams, 'kind'>>({
    depth: g.depth, width: g.width, height: g.height, wall: 'back', side: 'end', along: Math.round(g.width * 50) / 100, out: 1.5, offset: 0.5, nicheHeight: Math.min(2.1, g.height),
  });
  const [text, setText] = useState(() => outlineText(c.shape?.outline ?? [{ x: 0, y: 0 }, { x: g.depth, y: 0 }, { x: g.depth, y: g.width }, { x: 0, y: g.width }]));
  const set = (patch: Partial<typeof p>) => setP({ ...p, ...patch });
  const parsed = kind === 'contour' ? parseOutline(text) : null;
  const res: ShapeResult = parsed ? (parsed.error ? { ok: false, reason: parsed.error } : decomposeContour(parsed.points, p.height)) : templateShape({ ...p, kind: kind as TemplateParams['kind'] });
  const L = p.wall === 'front' || p.wall === 'back' ? p.width : p.depth;
  const apply = (d: ShapeDraft) => {
    let notes: string[] = [];
    void edit.apply((x) => { const r = applyShape(x, kind, d, clock.newId, parsed?.points); notes = r.notes; return r.config; }, `Форма: ${SHAPE_LABEL[kind].toLowerCase()}`)
      .then((ok) => { if (ok) toast.show(['Форма применена.', ...notes].join(' ')); });
  };
  const size = res.ok ? shapeSize(res.draft) : null;
  return (
    <Card title="Форма комнаты" subtitle="Г-, Т-, П-образная комната, ниша или контур с прямыми углами: основная часть и части у её стен. Части считаются волновой моделью ядра без приближения; колонки, слушатели и мебель стоят в основной части.">
      <div class="al-stack al-stack--16">
        <p class="al-text-small al-text-secondary">{c.shape ? `Сейчас: ${SHAPE_LABEL[c.shape.kind].toLowerCase()}, частей — ${c.shape.zoneIds.length}.` : 'Сейчас: прямоугольная комната.'}</p>
        <div class="al-grid">
          <SelectField label="Форма" value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: SHAPE_LABEL[k] }))} />
          <NumberField label="Высота" unit="м" value={p.height} min={DIM_LIMITS.height[0]} max={DIM_LIMITS.height[1]} onCommit={(v) => set({ height: v })} />
        </div>
        {kind !== 'contour' && (
          <div class="al-grid">
            <NumberField label="Основная часть: длина (от передней стены)" unit="м" value={p.depth} min={DIM_LIMITS.depth[0]} max={DIM_LIMITS.depth[1]} onCommit={(v) => set({ depth: v })} />
            <NumberField label="Основная часть: ширина" unit="м" value={p.width} min={DIM_LIMITS.width[0]} max={DIM_LIMITS.width[1]} onCommit={(v) => set({ width: v })} />
            {kind !== 'rect' && (
              <>
                <SelectField label="Стена, к которой примыкает часть" value={p.wall} onChange={(w) => set({ wall: w })} options={WALLS.map((w) => ({ value: w, label: `${WALL_LABEL[w][0].toUpperCase()}${WALL_LABEL[w].slice(1)} стена` }))} />
                {kind === 'l' && <SelectField label="Угол" value={p.side} onChange={(v) => set({ side: v })} options={[{ value: 'start', label: sideLabel(p.wall, 'start') }, { value: 'end', label: sideLabel(p.wall, 'end') }]} />}
                {kind === 'niche' && <NumberField label="Начало ниши вдоль стены" unit="м" value={p.offset} min={0} max={L} onCommit={(v) => set({ offset: v })} />}
                <NumberField label={kind === 'u' ? 'Длина каждой части вдоль стены' : 'Длина части вдоль стены'} unit="м" value={p.along} min={0.3} max={L} onCommit={(v) => set({ along: v })} />
                <NumberField label="Глубина части от стены" unit="м" value={p.out} min={0.3} max={20} onCommit={(v) => set({ out: v })} />
                {kind === 'niche' && <NumberField label="Высота ниши" unit="м" value={p.nicheHeight} min={0.51} max={p.height} onCommit={(v) => set({ nicheHeight: v })} />}
              </>
            )}
          </div>
        )}
        {kind === 'contour' && (
          <TextField label="Точки контура" multiline value={text} onInput={setText}
            hint="По одной точке «x; y» в строке, метры: x — от передней стены, y — от левой. Обход по порядку, стены под прямым углом. Начало координат перенесётся в передний левый угол основной части." />
        )}
        {res.ok ? (
          <>
            <PlanView title="Предпросмотр формы" depth={res.draft.depth} width={res.draft.width} height={res.draft.height} items={[]} annexes={draftAnnexes(res.draft)} />
            <p class="al-text-small al-text-secondary">{`Основная часть ${n2(res.draft.depth)} × ${n2(res.draft.width)} × ${n2(res.draft.height)} м, частей — ${res.draft.wings.length}; площадь пола ${n2(size!.area)} м², объём ${n2(size!.volume)} м³.${res.draft.wings.length ? ' Расчёт баса — волновой моделью ядра: он дольше прямоугольного.' : ''}`}</p>
            <div class="al-row"><Button variant="primary" small onClick={() => apply(res.draft)}>Применить форму</Button></div>
          </>
        ) : <Notice tone="warning" title="Форму нельзя применить">{res.reason}</Notice>}
      </div>
    </Card>
  );
}
