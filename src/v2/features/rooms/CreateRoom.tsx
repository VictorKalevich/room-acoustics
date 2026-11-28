// Создание комнаты (V2-018, D61). Первый шаг — способ, оба на одном уровне: по скану или вручную. По скану размеры,
// проёмы и мебель берутся из файла, поэтому размеры не запрашиваются. Начальная аудиосистема выбирается с продвинутого
// уровня; по умолчанию — стерео 2.1, как у нового проекта legacy (R14).
import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Icon, Notice, NumberField, SegmentedControl, TextField, useToast } from '../../design-system';
import { DEFAULT_NEW_ROOM, STARTER_LAYOUTS, newRoomIssues, type NewRoomInput, type StarterLayout } from '../../application/rooms';
import { scanDims } from '../../application/scan';
import { effectiveComplexity } from '../../application/settings';
import { visibleAt } from '../../domain/complexity';
import { DIM_LIMITS } from '../../domain/validation';
import { useApp } from '../../shared/context';
import { LAYOUT_LABEL, meters, nextRoomName, num } from '../../shared/format';
import { href, navigate, roomHref, type NewRoomMode } from '../../shared/router';
import { Screen } from '../../shared/Screen';
import { ScanPicker, ScanReview, useScanImport } from '../scan/ScanImport';

const MODES: { value: NewRoomMode; title: string; text: string }[] = [
  { value: 'scan', title: 'По скану', text: 'Файл из приложения сканирования: OBJ, GLB, glTF, PLY или STL. Размеры, двери, окна и мебель берутся из скана.' },
  { value: 'manual', title: 'Вручную', text: 'Длина, ширина и высота прямоугольной комнаты. Проёмы, мебель и форму можно добавить позже в модели.' },
];

export function CreateRoom({ mode }: { mode?: NewRoomMode }) {
  const { rooms, settings } = useApp();
  const toast = useToast();
  const scan = useScanImport();
  const level = effectiveComplexity(settings, 'rooms:create');
  const [name, setName] = useState('');
  const [fallbackName, setFallbackName] = useState('Комната 1');
  const [depth, setDepth] = useState<number | null>(DEFAULT_NEW_ROOM.depth);
  const [width, setWidth] = useState<number | null>(DEFAULT_NEW_ROOM.width);
  const [height, setHeight] = useState<number | null>(DEFAULT_NEW_ROOM.height);
  const [layout, setLayout] = useState<StarterLayout>(DEFAULT_NEW_ROOM.layout);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});

  useEffect(() => { rooms.list().then((l) => setFallbackName(nextRoomName(l.rooms.map((r) => r.name))), () => undefined); }, [rooms]);

  const fromScan = mode === 'scan' ? scan.ready : null;
  const dims = mode === 'manual' ? { depth: depth ?? NaN, width: width ?? NaN, height: height ?? NaN } : fromScan ? scanDims(fromScan.choice) : null;
  const input: NewRoomInput | null = dims ? { name: name.trim() || fallbackName, ...dims, layout } : null;
  const issues = input ? newRoomIssues(input) : [];
  const blocked = !input || issues.length > 0 || (mode === 'manual' && Object.values(invalid).some(Boolean));
  const issueFor = (path: string) => issues.find((i) => i.path === path)?.message;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (blocked || !input) return;
    setBusy(true);
    try {
      const room = await rooms.create(input, fromScan ?? undefined);
      toast.show(fromScan ? `Комната «${room.name}» создана по скану «${fromScan.info.fileName}»` : `Комната «${room.name}» создана`);
      navigate(roomHref(room.id), true);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const dimField = (label: string, key: 'depth' | 'width' | 'height', value: number | null, set: (v: number | null) => void, hint: string) => (
    <NumberField label={label} unit="м" value={value} min={DIM_LIMITS[key][0]} max={DIM_LIMITS[key][1]} decimals={2} onCommit={set}
      onValidity={(ok) => setInvalid((m) => ({ ...m, [key]: !ok }))}
      hint={`${hint} От ${num(DIM_LIMITS[key][0])} до ${num(DIM_LIMITS[key][1])} м.`} error={value === null ? 'Введите размер в метрах.' : issueFor(key)} />
  );

  return (
    <Screen title="Новая комната" backHref={href({ name: 'rooms' })} reading>
      <form class="al-stack al-stack--24" onSubmit={submit} noValidate>
        <div class="al-stack al-stack--8">
          <h1 class="al-text-headline">Новая комната</h1>
          <p class="al-text-secondary">Выберите, как задать помещение. Аудиосистему, слушателей, материалы и обработку можно уточнить позже в модели.</p>
        </div>
        <fieldset class="al-choices">
          <legend class="al-visually-hidden">Как задать комнату</legend>
          {MODES.map((m) => (
            <label key={m.value} class="al-choice">
              <input type="radio" name="room-source" value={m.value} checked={mode === m.value} onChange={() => navigate({ name: 'room-new', mode: m.value }, true)} />
              <span class="al-choice__body">
                <span class="al-choice__title">{m.title}</span>
                <span class="al-choice__text">{m.text}</span>
              </span>
              <Icon name="check" class="al-choice__mark" />
            </label>
          ))}
        </fieldset>
        {mode === 'scan' && (
          <Card title="Файл скана" subtitle="Распознаются размеры, двери, окна, мебель и коридор. Материалы по скану не определяются — их задают в модели.">
            <div class="al-stack al-stack--16">
              <ScanPicker scan={scan} />
              <ScanReview scan={scan} />
            </div>
          </Card>
        )}
        {mode && (
          <Card>
            <div class="al-stack al-stack--16">
              <TextField label="Название" value={name} onInput={setName} placeholder={fallbackName} maxLength={80} hint={`Необязательно. Без названия — «${fallbackName}».`} />
              {mode === 'manual' && dimField('Длина', 'depth', depth, setDepth, 'От передней стены (где колонки) до задней.')}
              {mode === 'manual' && dimField('Ширина', 'width', width, setWidth, 'От левой стены до правой.')}
              {mode === 'manual' && dimField('Высота', 'height', height, setHeight, 'От пола до потолка.')}
              {visibleAt('advanced', level) && (
                <SegmentedControl label="Начальная аудиосистема" value={layout} onChange={setLayout} block options={STARTER_LAYOUTS.map((l) => ({ value: l, label: LAYOUT_LABEL[l] }))} />
              )}
            </div>
          </Card>
        )}
        {dims && !blocked && (
          <p class="al-text-small al-text-secondary">{fromScan ? 'По скану: объём' : 'Объём'} {num(dims.depth * dims.width * dims.height, 1)} м³, площадь пола {num(dims.depth * dims.width, 1)} м². Колонки и слушатель расставляются по умолчанию; их положение можно изменить на плане. Размеры {meters(dims.depth)} × {meters(dims.width)} × {meters(dims.height)}.</p>
        )}
        {mode === 'scan' && !fromScan && !scan.busy && <p class="al-text-small al-text-secondary">Комната создаётся после распознавания скана.</p>}
        {failed && <Notice tone="danger" title="Комната не создана">{failed}</Notice>}
        {mode && (
          <div class="al-row al-row--end al-row--12">
            <a class="al-btn al-btn--ghost" href={href({ name: 'rooms' })}>Отмена</a>
            <Button type="submit" variant="primary" icon="check" busy={busy} disabled={blocked}>Создать</Button>
          </div>
        )}
      </form>
    </Screen>
  );
}
