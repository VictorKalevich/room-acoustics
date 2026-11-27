// Создание комнаты (V2-018, макеты M03/D03): в простом режиме — название (необязательно) и три размера.
// Начальная аудиосистема выбирается с продвинутого уровня; по умолчанию — стерео 2.1, как у нового проекта legacy (R14).
import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Notice, NumberField, SegmentedControl, TextField, useToast } from '../../design-system';
import { DEFAULT_NEW_ROOM, STARTER_LAYOUTS, newRoomIssues, type StarterLayout } from '../../application/rooms';
import { effectiveComplexity } from '../../application/settings';
import { visibleAt } from '../../domain/complexity';
import { DIM_LIMITS } from '../../domain/validation';
import { useApp } from '../../shared/context';
import { LAYOUT_LABEL, meters, nextRoomName, num } from '../../shared/format';
import { href, navigate, roomHref } from '../../shared/router';
import { Screen } from '../../shared/Screen';

export function CreateRoom() {
  const { rooms, settings } = useApp();
  const toast = useToast();
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

  const input = { name: name.trim() || fallbackName, depth: depth ?? NaN, width: width ?? NaN, height: height ?? NaN, layout };
  const issues = newRoomIssues(input);
  const blocked = issues.length > 0 || Object.values(invalid).some(Boolean);
  const issueFor = (path: string) => issues.find((i) => i.path === path)?.message;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (blocked) return;
    setBusy(true);
    try {
      const room = await rooms.create(input);
      toast.show(`Комната «${room.name}» создана`);
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
          <p class="al-text-secondary">Пока нужна прямоугольная форма и три размера. Аудиосистему, слушателей, мебель, материалы и обработку можно уточнить позже в модели.</p>
        </div>
        <Card>
          <div class="al-stack al-stack--16">
            <TextField label="Название" value={name} onInput={setName} placeholder={fallbackName} maxLength={80} hint={`Необязательно. Без названия — «${fallbackName}».`} />
            {dimField('Длина', 'depth', depth, setDepth, 'От передней стены (где колонки) до задней.')}
            {dimField('Ширина', 'width', width, setWidth, 'От левой стены до правой.')}
            {dimField('Высота', 'height', height, setHeight, 'От пола до потолка.')}
            {visibleAt('advanced', level) && (
              <SegmentedControl label="Начальная аудиосистема" value={layout} onChange={setLayout} block options={STARTER_LAYOUTS.map((l) => ({ value: l, label: LAYOUT_LABEL[l] }))} />
            )}
          </div>
        </Card>
        {depth && width && height && !blocked && (
          <p class="al-text-small al-text-secondary">Объём {num(depth * width * height, 1)} м³, площадь пола {num(depth * width, 1)} м². Колонки и слушатель расставляются по умолчанию; их положение можно изменить на плане. Размеры {meters(depth)} × {meters(width)} × {meters(height)}.</p>
        )}
        {failed && <Notice tone="danger" title="Комната не создана">{failed}</Notice>}
        <div class="al-row al-row--end al-row--12">
          <a class="al-btn al-btn--ghost" href={href({ name: 'rooms' })}>Отмена</a>
          <Button type="submit" variant="primary" icon="check" busy={busy} disabled={blocked}>Создать</Button>
        </div>
      </form>
    </Screen>
  );
}
