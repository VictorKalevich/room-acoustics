// Скан помещения (V2-046): файл сканирования → распознавание в воркере ядра скана → выбор найденного → применение к
// выбранной конфигурации с отменой. Чтение файла (three.js) загружается только при выборе файла.
import { useState } from 'preact/hooks';
import { Button, Card, Checkbox, KeyValue, LoadingState, Notice, SelectField, Switch, useToast } from '../../design-system';
import { WALL_LABEL } from '../../application/editing';
import { SCAN_FURNITURE, WALL_ITEM_LABEL, applyScan, scanChoice, scanDimsProblem, scanInfo, wallItems } from '../../application/scan';
import type { WallItemKind } from '../../../core/wallItems';
import type { Units } from '../../../scan/detect';
import type { DetectDone, ScanMessage, ScanReply } from '../../../workers/detectJobs';
import { useApp } from '../../shared/context';
import { dateTime } from '../../shared/format';
import type { ConfigEdit } from './useConfig';

const UNITS: { value: Units | 'auto'; label: string }[] = [
  { value: 'auto', label: 'Определить автоматически' }, { value: 'm', label: 'Метры' }, { value: 'cm', label: 'Сантиметры' }, { value: 'mm', label: 'Миллиметры' },
];
const UNIT_NAME: Record<Units, string> = { m: 'метры', cm: 'сантиметры', mm: 'миллиметры' };
const KINDS: WallItemKind[] = ['door', 'window', 'arch'];
const n2 = (v: number) => v.toFixed(2).replace('.', ',');

interface Loaded { fileName: string; format: string; triangles: Float32Array; labels?: ScanMessage['labels']; count: number; decimated: boolean }
interface Found extends DetectDone { kinds: WallItemKind[]; furniture: { on: boolean; sit: boolean }[]; corridor: boolean }

function detect(l: Loaded, units: Units | 'auto'): Promise<DetectDone> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('../../../workers/detect.worker.ts', import.meta.url), { type: 'module', name: 'v2-scan' });
    w.onmessage = (e: MessageEvent<ScanReply>) => {
      w.terminate();
      const r = e.data;
      if (r.ok && 'result' in r) resolve(r);
      else reject(new Error(r.ok ? 'Распознавание вернуло неполный ответ.' : r.error));
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'Распознавание скана не удалось.')); };
    const triangles = l.triangles.slice();
    const msg: ScanMessage = { units: units === 'auto' ? undefined : units, labels: l.labels, triangles };
    w.postMessage(msg, [triangles.buffer]);
  });
}

export function ScanCard({ edit }: { edit: ConfigEdit }) {
  const { clock } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [units, setUnits] = useState<Units | 'auto'>('auto');
  const [found, setFound] = useState<Found | null>(null);
  const info = scanInfo(edit.config);

  const run = async (l: Loaded, u: Units | 'auto') => {
    setBusy('Распознаём комнату…');
    setError(null);
    try {
      const r = await detect(l, u);
      setFound({ ...r, kinds: wallItems(r.layout).map((f) => f.guess), furniture: r.layout.furniture.map((f) => ({ on: true, sit: ['sofa', 'couch', 'chair', 'armchair', 'bed'].includes(f.name) })), corridor: !!r.layout.extension });
    } catch (e) {
      setFound(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(null); }
  };
  const open = async (file: File | undefined) => {
    if (!file) return;
    setBusy('Читаем файл…');
    setError(null);
    setFound(null);
    try {
      const { loadScan } = await import('../../../scan/load');
      const s = await loadScan(file);
      const l: Loaded = { fileName: file.name, format: s.format, triangles: s.triangles, labels: s.labels, count: s.triangleCount, decimated: s.decimated };
      setLoaded(l);
      await run(l, units);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const det = found?.result;
  const problem = det ? scanDimsProblem(det) : null;
  const items = found ? wallItems(found.layout) : [];
  const apply = () => {
    if (!found || !det || !loaded) return;
    let notes: string[] = [];
    const choice = scanChoice(det, found.layout, found.kinds, found.furniture, found.corridor);
    const meta = { fileName: loaded.fileName, format: loaded.format, units: det.units, unitsGuessed: det.unitsGuessed, confidence: det.confidence, depth: det.depth, width: det.width, height: det.height, warnings: det.warnings };
    void edit.apply((x) => { const r = applyScan(x, choice, meta, clock.newId, clock.now()); notes = r.notes; return r.config; }, 'Скан помещения')
      .then((ok) => { if (ok) { toast.show(['Скан применён: размеры, проёмы и мебель из скана.', ...notes].join(' ')); setFound(null); } });
  };
  return (
    <Card title="Скан помещения" subtitle="OBJ, GLB, glTF со встроенными данными, PLY, STL — экспорт приложений сканирования (RoomPlan, Polycam и других). Распознаются размеры, двери, окна, мебель и коридор; материалы поверхностей по скану не определяются — их задают вручную.">
      <div class="al-stack al-stack--16">
        {info && <p class="al-text-small al-text-secondary">{`Применён скан «${info.fileName}»: ${n2(info.depth)} × ${n2(info.width)} × ${n2(info.height)} м, ${dateTime(info.appliedAt)}. Найденное в скане помечено; новое применение заменяет только его.`}</p>}
        <div class="al-row al-row--12 al-row--bottom">
          <label class="al-btn al-btn--secondary">
            <input class="al-visually-hidden" type="file" accept=".obj,.glb,.gltf,.ply,.stl" aria-label="Файл скана" onChange={(e) => void open(e.currentTarget.files?.[0])} />
            Выбрать файл скана
          </label>
          <SelectField label="Единицы файла" value={units} compact onChange={(u) => { setUnits(u); if (loaded) void run(loaded, u); }} options={UNITS} />
        </div>
        <p class="al-text-small al-text-secondary">Прямой доступ к LiDAR и RoomPlan из браузера не гарантирован: отсканируйте комнату в приложении и откройте экспортированный файл. Файл скана в приложении не сохраняется.</p>
        {busy && <LoadingState text={busy} />}
        {error && <Notice tone="danger" title="Скан не прочитан">{error}</Notice>}
        {found && det && loaded && !busy && (
          <div class="al-stack al-stack--16">
            <p class="al-text-small">{`Файл «${loaded.fileName}»`}</p>
            <KeyValue items={[
              ['Размеры', `${n2(det.depth)} × ${n2(det.width)} × ${n2(det.height)} м`],
              ['Единицы', `${UNIT_NAME[det.units]}${det.unitsGuessed ? ' (угаданы)' : ''}`],
              ['Уверенность', `${Math.round(det.confidence * 100)} %`],
              ['Треугольников', `${loaded.count.toLocaleString('ru-RU')}${loaded.decimated ? ', прорежено' : ''}`],
            ]} />
            {det.warnings.length > 0 && <Notice tone="warning" title="Проверьте распознавание">{det.warnings.join(' ')}</Notice>}
            {problem && <Notice tone="danger">{problem}</Notice>}
            {items.length > 0 && (
              <div class="al-stack al-stack--8" role="group" aria-label="Двери, окна и проёмы из скана">
                <span class="al-text-lead">Двери, окна и проёмы</span>
                {items.map((it, k) => (
                  <SelectField key={k} label={`${WALL_LABEL[it.wall][0].toUpperCase()}${WALL_LABEL[it.wall].slice(1)} стена, ${n2(it.a0)}–${n2(it.a1)} м`} value={found.kinds[k]}
                    onChange={(v) => setFound({ ...found, kinds: found.kinds.map((x, i) => (i === k ? v : x)) })} options={KINDS.map((x) => ({ value: x, label: WALL_ITEM_LABEL[x] }))} />
                ))}
              </div>
            )}
            {found.layout.furniture.length > 0 && (
              <div class="al-stack al-stack--8" role="group" aria-label="Мебель из скана">
                <span class="al-text-lead">Мебель</span>
                {found.layout.furniture.map((f, k) => (
                  <Checkbox key={k} label={`${SCAN_FURNITURE[f.name] ?? 'Мебель'}, ${n2(f.x1 - f.x0)} × ${n2(f.y1 - f.y0)} м`} checked={found.furniture[k].on}
                    onChange={(v) => setFound({ ...found, furniture: found.furniture.map((x, i) => (i === k ? { ...x, on: v } : x)) })} />
                ))}
              </div>
            )}
            {found.layout.extension && <Switch label="Учесть коридор за проёмом" checked={found.corridor} onChange={(v) => setFound({ ...found, corridor: v })} hint="Смежная зона ядра: считается волновой моделью." />}
            <div class="al-row">
              <Button variant="primary" small disabled={!!problem} onClick={apply}>Применить к конфигурации</Button>
              <Button variant="ghost" small onClick={() => setFound(null)}>Отказаться</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
