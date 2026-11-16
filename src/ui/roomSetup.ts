// Действия пользователя с комнатой проекта (037): по операции на действие. Операция сама меняет проект (через
// обработчик экрана, переходы 031), черновик конструктора и скан на устройстве и делает постоянный для действия
// переход — в том порядке, в каком это делали экраны. Чистая часть — функции `…Change`: каким станет проект.
// Таблица действий и порядок — specs/037-room-setup-operations/spec.md.
import type { Project } from '../state/project';
import { clearedRoom, defaultConstraints, makeId, newProject, rotateRoom, rotateSetup } from '../state/project';
import { deleteProject, deleteScan, saveScan, thinScan, type StoredScan } from '../state/storage';
import { logError } from '../state/errlog';
import { fixScan, scanRoom, type ScanChoice, type ScanNames, type ScanRect } from '../scan/apply';
import type { DetectResult, Units } from '../scan/detect';
import type { LayoutResult, ScanLabels } from '../scan/layout';
import type { Room } from '../core/types';
import { dropRoomDraft, saveRoomDraft, type RoomDraft } from './roomDraft';
import { requestScanFix } from './scanFix';
import type { Destination } from './navigation';
import { S } from './strings';

/** Изменение проекта действием с комнатой: комната и поля, которые экран передаёт в `onRoom` (переход `changeRoom`). */
export interface RoomChange { room: Room; extra: Partial<Project> }
export type OnRoom = (room: Room, extra?: Partial<Project>) => void;

/** Хранилища на устройстве, с которыми работают операции; в тестах — заглушки. */
export interface SetupStores {
  dropRoomDraft: (projectId: string) => void;
  saveRoomDraft: (projectId: string, d: RoomDraft) => void;
  saveScan: (s: StoredScan) => Promise<unknown>;
  deleteScan: (projectId: string) => Promise<unknown>;
  deleteProject: (id: string, keepScan: boolean) => Promise<unknown>;
  logError: typeof logError;
}
export const DEVICE: SetupStores = { dropRoomDraft, saveRoomDraft, saveScan, deleteScan, deleteProject, logError };

/** Файл скана в памяти: сетка в координатах файла и сведения о нём. */
export interface ScanFile {
  fileName: string;
  format: string;
  count: number;
  decimated: boolean;
  dropped: number;
  thinned?: boolean;
  triangles: Float32Array;
  labels?: ScanLabels;
}

/** Применяемый скан: файл, распознавание, исходный выбор (вся найденная комната), выбор для комнаты, единицы. */
export interface ScanApply {
  file: ScanFile;
  det: DetectResult;
  initial: { layout: LayoutResult; rect: ScanRect };
  choice: ScanChoice;
  units: Units | 'auto';
}

/** Выбор, применённый к комнате в этом сеансе или сохранённый вместе со сканом. */
export interface AppliedChoice { choice: ScanChoice; units: Units }

const NAMES: ScanNames = {
  furniture: (n) => S.layout.furnitureNames[n] ?? S.layout.furnitureOther,
  corridor: S.openings.corridor,
  id: makeId,
};

function zoneFor(room: Room) {
  const d = defaultConstraints(room);
  return { listenerMinX: d.listenerMinX, listenerMaxX: d.listenerMaxX };
}

const summaryOf = (d: DetectResult, f: ScanFile) => {
  const { transform: _t, ...rest } = d;
  void _t;
  return { ...rest, fileName: f.fileName, format: f.format };
};

const turned = (info: NonNullable<Project['scanInfo']>) => ({ ...info, rotation: ((info.rotation ?? 0) + 1) % 4 });

// ---------- Чистая часть: каким станет проект ----------

/**
 * Первое применение скана — как «Применить размеры» (020). Новый скан поверх уже применённого сбрасывает комнату так
 * же, как «Очистить». Комната ещё не создана: её проверяют по тем же шагам, что и при ручном вводе (022).
 */
export function scanChange(p: Project, s: ScanApply): RoomChange {
  const reset = p.scanInfo ? clearedRoom(p) : null;
  const room = scanRoom(reset?.room ?? p.room, s.choice, 'first', NAMES);
  return {
    room,
    extra: {
      ...reset,
      scanInfo: { ...summaryOf(s.det, s.file), rotation: 0, applied: { rect: s.choice.rect, units: s.det.units } },
      constraints: { ...(reset?.constraints ?? p.constraints), ...zoneFor(room) },
      roomReady: false,
    },
  };
}

/** Поправка границ того же скана: найденное пересоздаётся, ручное остаётся на своих местах (020). */
export function scanFixChange(p: Project, s: ScanApply, applied: AppliedChoice | null): RoomChange {
  // от каких границ считать сдвиг: от тех, по которым построена комната проекта (026 — хранятся в проекте и
  // откатываются вместе с ним); у проектов до 026 — от сохранённых вместе со сканом
  const known = p.scanInfo?.applied ?? (applied ? { rect: applied.choice.rect, units: applied.units } : null);
  const prev = known && known.units === s.det.units ? known.rect : s.choice.rect;
  const rotation = p.scanInfo?.rotation ?? 0;
  const fixed = fixScan(p, s.choice, prev, rotation, NAMES);
  return {
    room: fixed.room,
    extra: {
      current: fixed.current,
      setups: fixed.setups,
      scanInfo: { ...summaryOf(s.det, s.file), rotation, applied: { rect: s.choice.rect, units: s.det.units } },
      constraints: { ...p.constraints, ...zoneFor(fixed.room) },
    },
  };
}

/** «Сохранить» в конструкторе: комната конструктора — в проект, комната создана (021). */
export const savedChange = (room: Room): RoomChange => ({ room, extra: { roomReady: true } });

/** Скан при проверке по шагам: колонки у другой стены — поворот сразу в проекте (комната ещё не создана). */
export function stepsTurnChange(p: Project, room: Room): RoomChange {
  return { room: rotateRoom(room), extra: p.scanInfo ? { scanInfo: turned(p.scanInfo) } : {} };
}

/** Переход к поправке границ с шага «Размеры»: введённое на шагах уходит в комнату проекта. */
export const toFixChange = (room: Room): RoomChange => ({ room, extra: {} });

/** «Очистить»: комната — как в новом проекте, места по умолчанию, без скана и результата подбора (020, 021). */
export function clearChange(p: Project): RoomChange {
  const c = clearedRoom(p);
  return { room: c.room, extra: c };
}

/** Поворот созданной комнаты: места поворачиваются вместе с ней, счётчик поворота скана — для поправки границ. */
export function turnChange(p: Project): RoomChange {
  const room = p.room;
  return {
    room: rotateRoom(room),
    extra: {
      current: rotateSetup(room, p.current),
      setups: p.setups.map((x) => rotateSetup(room, x)),
      ...(p.scanInfo ? { scanInfo: turned(p.scanInfo) } : {}),
    },
  };
}

/** Чем заменить текущий проект (023): новый, сохранённый из списка или открытый из файла. */
export type Replace = { kind: 'new' } | { kind: 'open'; p: Project } | { kind: 'import'; p: Project };
export const replacement = (r: Replace): Project => (r.kind === 'new' ? newProject() : r.p);

// ---------- Операции ----------

/** Скан проекта — на устройство вместе с применённым выбором. Запись не ждём: её ошибка только пишется в журнал. */
function storeScan(projectId: string, s: ScanApply, st: SetupStores) {
  const t = thinScan(s.file.triangles, s.file.labels);
  const f = s.file;
  st.saveScan({
    projectId, fileName: f.fileName, format: f.format, count: f.count, decimated: f.decimated, dropped: f.dropped,
    thinned: t.thinned || !!f.thinned, triangles: t.triangles, labels: t.labels, units: s.units, det: s.det, initial: s.initial, applied: s.choice,
  }).catch((e) => st.logError('scan', e, 'сохранение скана на устройстве'));
}

/** Скан применён впервые или поверх прежнего — к шагам проверки. */
export function applyScan(p: Project, s: ScanApply, host: { onRoom: OnRoom; onGo?: (to: Destination) => void }, st = DEVICE): RoomChange {
  const c = scanChange(p, s);
  host.onRoom(c.room, c.extra);
  st.dropRoomDraft(p.id);
  host.onGo?.('room/size');
  storeScan(p.id, s, st);
  return c;
}

/** «Применить размеры» в «Поправить границы комнаты». */
export function applyScanFix(p: Project, s: ScanApply, applied: AppliedChoice | null, host: { onRoom: OnRoom; onGo?: (to: Destination) => void }, st = DEVICE): RoomChange {
  const c = scanFixChange(p, s, applied);
  host.onRoom(c.room, c.extra);
  // черновик конструктора снят с прежних границ — с новыми он вернул бы старую комнату
  st.dropRoomDraft(p.id);
  storeScan(p.id, s, st);
  // поправка во время проверки по шагам — назад к шагам
  if (!p.roomReady) host.onGo?.('room/size');
  return c;
}

/** «Сохранить» в конструкторе; куда перейти, решает конструктор. */
export function saveRoom(p: Project, room: Room, onRoom: OnRoom, st = DEVICE): RoomChange {
  const c = savedChange(room);
  onRoom(c.room, c.extra);
  st.dropRoomDraft(p.id);
  return c;
}

/** «Не сохранять» и «Сбросить черновик»: проект прежний. */
export function discardRoomDraft(p: Project, st = DEVICE): void {
  st.dropRoomDraft(p.id);
}

/** «Колонки у другой стены» при проверке скана: черновик продолжается с повёрнутой комнатой. */
export function turnInSteps(p: Project, room: Room, draft: Omit<RoomDraft, 'room'>, onRoom: OnRoom, st = DEVICE): RoomChange {
  const c = stepsTurnChange(p, room);
  onRoom(c.room, c.extra);
  st.saveRoomDraft(p.id, { room: c.room, ...draft });
  return c;
}

/** «Поправить границы комнаты» с шага «Размеры»: блок поправки — на обзоре комнаты. */
export function openScanFix(p: Project, room: Room, host: { onRoom: OnRoom; onBack: () => void }, st = DEVICE): RoomChange {
  const c = toFixChange(room);
  host.onRoom(c.room, c.extra);
  st.dropRoomDraft(p.id);
  requestScanFix();
  host.onBack();
  return c;
}

/** «Очистить»: скан проекта на устройстве тоже удаляется — после очистки можно выбрать новый скан. */
export function clearRoom(p: Project, onRoom: OnRoom, st = DEVICE): RoomChange {
  void st.deleteScan(p.id).catch(() => undefined);
  st.dropRoomDraft(p.id);
  const c = clearChange(p);
  onRoom(c.room, c.extra);
  return c;
}

/** «Колонки у другой стены» на обзоре созданной комнаты. */
export function turnRoom(p: Project, onRoom: OnRoom): RoomChange {
  const c = turnChange(p);
  onRoom(c.room, c.extra);
  return c;
}

/**
 * «Новый проект», «Открыть», «Импорт». Незаконченная настройка текущего проекта больше не нужна; скан проекта, которого
 * нет в списке сохранённых (`saved`), — тоже.
 */
export function switchProject(p: Project, r: Replace, saved: boolean, onReplace: (next: Project) => void, st = DEVICE): Project {
  const next = replacement(r);
  st.dropRoomDraft(p.id);
  if (!saved && next.id !== p.id) void st.deleteScan(p.id).catch(() => undefined);
  onReplace(next);
  return next;
}

/** «Удалить» сохранённый проект. У копии открытого проекта скан и черновик комнаты ещё нужны ему самому. */
export async function removeSaved(p: Project, id: string, st = DEVICE): Promise<void> {
  const open = id === p.id;
  await st.deleteProject(id, open).catch(() => undefined);
  if (!open) st.dropRoomDraft(id);
}
