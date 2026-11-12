// Локальное хранение проектов (IndexedDB) и файл проекта (contracts/project-file.md).
import { normalizeVoice } from '../core/voice';
import type { Project } from './project';
import { defaultConstraints, defaultRoom, defaultSetup, defaultSources, defaultSub, legacyPlaced, legacyRoomReady, makeId, syncSetup, validateRoom, validateSources } from './project';
import { fitRoomObjects } from '../core/fitRoom';
import type { FurnitureType, Measurement, Room, Setup, SourceSpec } from '../core/types';
import { DAMPING_MODEL, SURFACES } from '../core/types';
import { MATERIAL_BY_ID } from '../core/materials';
import { FURNITURE } from '../core/furniture';
import { HISTORY_MAX } from './variant';
import { normalizeObjective } from '../core/objective';
import { normalizePrecision } from '../core/precision';
import type { DetectResult, Units } from '../scan/detect';
import type { LayoutResult, ScanLabels } from '../scan/layout';
import type { ScanChoice, ScanRect } from '../scan/apply';

export const FILE_FORMAT = 'room-acoustics-project';
export const FILE_VERSION = 5; // 4: обработка, скос потолка, окна и двери, фильтры сабвуферов; 5: история замеров
export const FILE_EXT = '.roomacoustics.json';

/** Замер пригоден: частоты и уровни — числа, поровну, хотя бы несколько точек. */
function validMeasurement(m: any): m is Measurement {
  return !!m && Array.isArray(m.f) && Array.isArray(m.db) && m.f.length >= 2 && m.f.length === m.db.length
    && m.f.every((v: unknown) => typeof v === 'number' && Number.isFinite(v)) && m.db.every((v: unknown) => typeof v === 'number' && Number.isFinite(v));
}

export function serializeProject(p: Project): string {
  return JSON.stringify({ format: FILE_FORMAT, version: FILE_VERSION, project: p }, null, 2);
}

export function parseProjectFile(text: string): Project {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Файл повреждён: это не JSON.');
  }
  if (!data || data.format !== FILE_FORMAT) throw new Error('Это не файл проекта «Акустика комнаты».');
  if (typeof data.version !== 'number' || data.version > FILE_VERSION) {
    throw new Error('Файл создан более новой версией приложения. Обновите приложение.');
  }
  return normalizeProject(data.project ?? {});
}

/**
 * Комната: отсутствующие поля — умолчания, неверные элементы отбрасываются, диапазоны проверяются.
 * fit = false (черновик конструктора, 021): объекты за стенами остаются как есть — список удаляемого
 * пользователь увидит перед сохранением; проверка при этом идёт по вписанной копии.
 */
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object';

/** Сведения о скане: неверные применённые границы (026) отбрасываются — тогда берутся сохранённые на устройстве. */
function normalizeScanInfo(raw: unknown): Project['scanInfo'] {
  if (!isObj(raw)) return null;
  const a = raw.applied;
  const ok = isObj(a) && isObj(a.rect) && ['m', 'cm', 'mm'].includes(a.units)
    && [a.rect.x0, a.rect.x1, a.rect.y0, a.rect.y1].every((v) => typeof v === 'number' && Number.isFinite(v)) && a.rect.x1 > a.rect.x0 && a.rect.y1 > a.rect.y0;
  if (ok || a === undefined) return raw as Project['scanInfo'];
  const { applied: _bad, ...rest } = raw;
  void _bad;
  return rest as Project['scanInfo'];
}
const finite = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function normalizeRoom(rawRoom: any, fit = true): Room {
  const room = { ...defaultRoom(), ...rawRoom };
  if (!['empty', 'typical', 'heavy'].includes(room.furnishing)) room.furnishing = defaultRoom().furnishing;
  room.materials = { ...defaultRoom().materials, ...rawRoom?.materials };
  for (const s of SURFACES) if (!MATERIAL_BY_ID[room.materials[s]]) room.materials[s] = defaultRoom().materials[s];
  room.zones = Array.isArray(room.zones) ? room.zones.filter(isObj) : [];
  if (!['sealed', 'typical', 'door', 'open'].includes(room.leakage)) room.leakage = 'typical';
  if (room.calibration && !(room.calibration.dampingScale > 0)) room.calibration = null;
  // множитель, подобранный для прежней модели затухания, к новой не подходит — подстройку нужно повторить
  if (room.calibration && room.calibration.model !== DAMPING_MODEL) room.calibration = null;
  if (room.calibration && room.calibration.leakageBefore !== undefined && !['sealed', 'typical', 'door', 'open'].includes(room.calibration.leakageBefore)) {
    const { leakageBefore: _bad, ...rest } = room.calibration;
    void _bad;
    room.calibration = rest;
  }
  room.openings = Array.isArray(room.openings) ? room.openings.filter(isObj) : [];
  room.extensions = Array.isArray(room.extensions) ? room.extensions.filter(isObj) : [];
  room.treatments = Array.isArray(room.treatments)
    ? room.treatments.filter((t: any) => t && ['corner', 'panel', 'cloud'].includes(t.kind) && t.width > 0 && t.height > 0 && t.thickness > 0)
    : [];
  room.treatmentsOn = !!room.treatmentsOn;
  if (!room.slope || !['front', 'back', 'left', 'right'].includes(room.slope.wall) || !(room.slope.low > 0) || !(room.slope.run > 0)) room.slope = null;
  room.features = Array.isArray(room.features)
    ? room.features.filter((f: any) => f && (f.kind === 'window' || f.kind === 'door') && ['front', 'back', 'left', 'right'].includes(f.wall) && f.a1 > f.a0)
    : [];
  if (!['auto', 'modal', 'wave'].includes(room.model)) room.model = 'auto';
  // 019: тип и высота мебели, ковры и шторы, обстановка по списку (необязательные поля)
  room.zones = room.zones.map((z: any) => {
    const n = { ...z };
    if (n.furniture !== undefined && (n.kind !== 'furniture' || !FURNITURE[n.furniture as FurnitureType])) delete n.furniture;
    if (n.height !== undefined && !(Number.isFinite(n.height) && n.height > 0)) delete n.height;
    return n;
  });
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  room.coverings = Array.isArray(room.coverings)
    ? room.coverings.filter((c: any) => c
      && (c.kind === 'carpet' ? ['thin', 'thick'].includes(c.grade) : c.kind === 'curtain' && ['light', 'heavy'].includes(c.grade))
      && ['floor', 'front', 'back', 'left', 'right'].includes(c.surface)
      && !(c.kind === 'curtain' && c.surface === 'floor')
      && [c.u0, c.u1, c.v0, c.v1].every(num) && c.u1 > c.u0 && c.v1 > c.v0)
    : [];
  room.furnitureList = !!room.furnitureList;
  // 021: мебель, зоны, окна, ковры, скос и коридоры за стенами (после уменьшения комнаты) вписываются в комнату,
  // а не делают весь проект «неверным» — раньше такой проект не открывался и заменялся новым
  let fitted = fitRoomObjects(room).room;
  // коридор, который не проходит проверку и после вписывания (например, мельче 0,3 м из скана), убирается —
  // раньше из-за него не открывался весь проект
  const badExt = new Set(validateRoom(fitted).filter((e) => e.field.startsWith('ext.')).map((e) => e.field.slice(4)));
  if (badExt.size) {
    room.extensions = room.extensions.filter((e: any) => !badExt.has(e.id));
    fitted = { ...fitted, extensions: (fitted.extensions ?? []).filter((e) => !badExt.has(e.id)) };
  }
  const roomErr = validateRoom(fitted);
  if (roomErr.length) throw new Error(`Неверные данные комнаты: ${roomErr.map((e) => e.message).join('; ')}`);
  return fit ? fitted : room;
}

/** Заполняет отсутствующие поля умолчаниями и проверяет диапазоны. */
export function normalizeProject(raw: any): Project {
  const room = normalizeRoom(raw.room);
  const listed: SourceSpec[] = Array.isArray(raw.sources) ? raw.sources.filter((s: unknown) => isObj(s) && typeof (s as SourceSpec).id === 'string' && ((s as SourceSpec).kind === 'sub' || (s as SourceSpec).kind === 'speaker')) : [];
  const rawSources = listed.length ? listed : defaultSources(2, 1);
  // неверный диапазон или высота одного источника (например, поле правили и не закончили) — к значениям по
  // умолчанию для него: раньше из-за этого проект не открывался и заменялся новым
  const sources = rawSources.map((s, i) => {
    const d = s.kind === 'sub' ? defaultSub(i + 1) : defaultSources(1, 0)[0];
    const n = s.kind === 'sub' ? { ...d, ...s } : { ...s };
    if (!(n.fLow >= 10 && n.fHigh <= 24000 && n.fLow < n.fHigh)) { n.fLow = d.fLow; n.fHigh = d.fHigh; }
    if (!(n.height >= 0 && n.height <= 3)) n.height = d.height;
    return n;
  });
  const srcErr = validateSources(sources);
  if (srcErr.length) throw new Error(`Неверные источники: ${srcErr.map((e) => e.message).join('; ')}`);
  const dc = defaultConstraints(room);
  const constraints = {
    ...dc,
    ...raw.constraints,
    seats: { ...dc.seats, ...raw.constraints?.seats },
    crossover: { ...dc.crossover, ...raw.constraints?.crossover },
    objective: normalizeObjective(raw.constraints?.objective),
  };
  for (const k of ['speakerMinFront', 'speakerMinSide', 'listenerMinX', 'listenerMaxX', 'earHeight', 'subWallGap'] as const) constraints[k] = finite(constraints[k], dc[k]);
  if (!['corners', 'walls', 'anywhere'].includes(constraints.subZone)) constraints.subZone = dc.subZone;
  constraints.seats = { count: finite(constraints.seats.count, dc.seats.count), spacing: finite(constraints.seats.spacing, dc.seats.spacing) };
  for (const k of ['spkLimit', 'subLimit'] as const) if (!(typeof constraints.crossover[k] === 'number' && constraints.crossover[k] >= 10 && constraints.crossover[k] <= 24000)) delete constraints.crossover[k];
  const okPoint = (p: any) => isObj(p) && [p.x, p.y, p.z].every((v) => typeof v === 'number' && Number.isFinite(v));
  const fixSetup = (s: any, name: string): Setup =>
    syncSetup(
      {
        ...defaultSetup(room, sources, constraints, name),
        ...(isObj(s) ? s : {}),
        // координаты-не-числа (NaN в JSON становится null) — к местам по умолчанию
        ...(okPoint(s?.listener) ? {} : { listener: defaultSetup(room, sources, constraints, name).listener }),
        positions: Object.fromEntries(Object.entries(isObj(s?.positions) ? s.positions : {}).filter(([, v]) => okPoint(v))) as Setup['positions'],
        subSettings: isObj(s?.subSettings) ? s.subSettings : {},
        crossoverHz: s?.crossoverHz ?? null,
        measurement: validMeasurement(s?.measurement) ? s.measurement : null,
        history: Array.isArray(s?.history) && s.history.some(validMeasurement) ? s.history.filter(validMeasurement).slice(0, HISTORY_MAX) : undefined,
      },
      room,
      sources,
      constraints,
    );
  return {
    id: typeof raw.id === 'string' ? raw.id : makeId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Комната',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    room,
    sources,
    constraints,
    scanInfo: normalizeScanInfo(raw.scanInfo),
    result: raw.result ?? null,
    selectedIndex: typeof raw.selectedIndex === 'number' ? raw.selectedIndex : 0,
    current: (() => {
      const cur = fixSetup(raw.current, 'Текущая');
      // 022: признак «места выбраны»; у проектов до 022 — по тому, стоят ли места по умолчанию
      return { ...cur, placed: typeof raw.current?.placed === 'boolean' ? raw.current.placed : legacyPlaced(cur, room, sources, constraints) };
    })(),
    // сохранённый вариант — всегда выбранные места (до 022 признака не было)
    setups: Array.isArray(raw.setups) ? raw.setups.filter(isObj).map((s: any) => ({ ...fixSetup(s, s?.name ?? 'Вариант'), placed: true })) : [],
    ...(raw.voice ? { voice: normalizeVoice(raw.voice) } : {}),
    // 026: точность расчёта; стандартная в файл не пишется — прежние проекты и файлы не меняются
    ...(normalizePrecision(raw.precision) !== 'standard' ? { precision: normalizePrecision(raw.precision) } : {}),
    roomReady: typeof raw.roomReady === 'boolean' ? raw.roomReady : legacyRoomReady(room, raw),
  };
}

// ---------- IndexedDB ----------

const DB = 'room-acoustics';
const STORE = 'projects';
const META = 'meta';
/** 020: облегчённая сетка скана проекта — для «Поправить границы комнаты»; в файл проекта не входит. */
const SCANS = 'scans';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB недоступна'));
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(SCANS)) db.createObjectStore(SCANS, { keyPath: 'projectId' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Хранилище занято другой вкладкой приложения — закройте её.'));
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function storageAvailable(): Promise<boolean> {
  try {
    await tx(META, 'readwrite', (s) => s.put(1, 'probe'));
    return true;
  } catch {
    return false;
  }
}

export const saveProject = (p: Project) =>
  tx(STORE, 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(p))));
/** keepScan — сохранённая копия открытого проекта: скан на устройстве ещё нужен самому проекту. */
export const deleteProject = (id: string, keepScan = false) =>
  tx(STORE, 'readwrite', (s) => s.delete(id)).then(() => (keepScan ? undefined : deleteScan(id).catch(() => undefined)));
/** Сохранённые проекты проходят ту же нормализацию, что черновик и файл: проект старой версии открывается как при запуске. */
export const listProjects = () =>
  tx<Project[]>(STORE, 'readonly', (s) => s.getAll() as IDBRequest<Project[]>).then((all) =>
    all.map((p) => { try { return normalizeProject(p); } catch { return p; } }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
  );

/** Черновик текущего проекта — восстанавливается при следующем запуске. */
export const saveDraft = (p: Project) => tx(META, 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(p)), 'draft'));
/**
 * Несохранённый проект на момент ухода со страницы. Отложенное сохранение (300 мс после последнего изменения)
 * могло не успеть, а запись в IndexedDB при закрытии страницы браузер не гарантирует; localStorage пишется
 * синхронно. При запуске такая запись важнее сохранённого черновика.
 */
const PENDING_KEY = 'ra-draft-pending';
export function stashPendingDraft(p: Project): void {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify(p)); } catch { /* нет места или хранилища — остаётся отложенное сохранение */ }
}
export function clearPendingDraft(): void {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* нет хранилища */ }
}
function readPendingDraft(): Project | undefined {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Project) : undefined;
  } catch {
    return undefined;
  }
}

export const loadDraft = () =>
  tx<Project | undefined>(META, 'readonly', (s) => s.get('draft') as IDBRequest<Project | undefined>).catch(() => undefined).then(async (stored) => {
    const pending = readPendingDraft();
    // запись появляется только когда на устройстве состояние старее, и удаляется, как только оно сохранено
    if (pending) {
      try { return normalizeProject(pending); } catch { /* повреждён — берём сохранённый */ }
    }
    const d = stored;
    if (!d) return undefined;
    try {
      return normalizeProject(d);
    } catch (e) {
      // черновик не прошёл проверку: копия остаётся на устройстве (ключ draft-failed), а не затирается новым проектом
      await tx(META, 'readwrite', (s) => s.put(d, 'draft-failed')).catch(() => undefined);
      throw e;
    }
  });

/** Имя файла проекта по названию (024: экспорт идёт через «Поделиться» → «Сохранить в Файлы» или скачивание). */
export const projectFileName = (p: Project) => `${p.name.replace(/[\\/:*?"<>|]+/g, '_') || 'room'}${FILE_EXT}`;

// ---------- Скан проекта (020) ----------

/** Скан проекта на этом устройстве: сетка (в координатах файла), разметка, распознавание и применённый выбор. */
export interface StoredScan {
  projectId: string;
  fileName: string;
  format: string;
  /** Треугольников в исходном файле; сетка ниже может быть облегчена (thinned). */
  count: number;
  decimated: boolean;
  dropped: number;
  thinned: boolean;
  triangles: Float32Array;
  labels?: ScanLabels;
  units: Units | 'auto';
  det: DetectResult;
  initial: { layout: LayoutResult; rect: ScanRect };
  applied: ScanChoice;
}

export const saveScan = (s: StoredScan) => tx(SCANS, 'readwrite', (st) => st.put(s));
export const loadStoredScan = (projectId: string) =>
  tx<StoredScan | undefined>(SCANS, 'readonly', (st) => st.get(projectId) as IDBRequest<StoredScan | undefined>);
export const deleteScan = (projectId: string) => tx(SCANS, 'readwrite', (st) => st.delete(projectId));

/** Не больше max треугольников для хранения: каждый k-й треугольник вместе с разметкой. */
export function thinScan(triangles: Float32Array, labels: ScanLabels | undefined, max = 250_000): { triangles: Float32Array; labels?: ScanLabels; thinned: boolean } {
  const n = Math.floor(triangles.length / 9);
  if (n <= max) return { triangles, labels, thinned: false };
  const step = Math.ceil(n / max);
  const m = Math.ceil(n / step);
  const out = new Float32Array(m * 9);
  const ids = labels ? new Uint16Array(m) : undefined;
  for (let i = 0, j = 0; i < n; i += step, j++) {
    out.set(triangles.subarray(i * 9, i * 9 + 9), j * 9);
    if (ids && labels) ids[j] = labels.ids[i];
  }
  return { triangles: out, labels: labels && ids ? { ...labels, ids } : labels, thinned: true };
}
