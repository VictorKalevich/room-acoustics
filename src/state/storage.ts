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
import { cleanResult, cleanSubSettings, dropBad, isNum, isObj, isPoint, oneOf, WALLS } from './shape';

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
 * Сведения о скане: неверные применённые границы (026) отбрасываются — тогда берутся сохранённые на устройстве.
 * 028: поля, которые читает приложение, — своего типа: имя файла — строка (иначе пустое), уверенность распознавания
 * и число поворотов неверного типа убираются (читаются как «без предупреждения» и 0). Остальные поля только хранятся.
 */
function normalizeScanInfo(raw: unknown): Project['scanInfo'] {
  if (!isObj(raw)) return null;
  const okApplied = (a: any) => isObj(a) && isObj(a.rect) && ['m', 'cm', 'mm'].includes(a.units)
    && [a.rect.x0, a.rect.x1, a.rect.y0, a.rect.y1].every(isNum) && a.rect.x1 > a.rect.x0 && a.rect.y1 > a.rect.y0;
  const info = dropBad(raw, { applied: okApplied, confidence: isNum, rotation: Number.isInteger });
  return (typeof info.fileName === 'string' ? info : { ...info, fileName: '' }) as Project['scanInfo'];
}
const finite = (v: unknown, d: number) => (isNum(v) ? v : d);
const ZONE_KINDS = ['door', 'window', 'furniture', 'other'] as const;
const CORNERS = ['front-left', 'front-right', 'back-left', 'back-right'] as const;

/**
 * Комната: отсутствующие поля — умолчания, неверные элементы отбрасываются, диапазоны проверяются.
 * fit = false (черновик конструктора, 021): объекты за стенами остаются как есть — список удаляемого
 * пользователь увидит перед сохранением; проверка при этом идёт по вписанной копии.
 */
export function normalizeRoom(rawRoom: any, fit = true): Room {
  const room = { ...defaultRoom(), ...rawRoom };
  if (!['empty', 'typical', 'heavy'].includes(room.furnishing)) room.furnishing = defaultRoom().furnishing;
  room.materials = { ...defaultRoom().materials, ...rawRoom?.materials };
  for (const s of SURFACES) if (!MATERIAL_BY_ID[room.materials[s]]) room.materials[s] = defaultRoom().materials[s];
  room.zones = Array.isArray(room.zones) ? room.zones.filter(isObj) : [];
  if (!['sealed', 'typical', 'door', 'open'].includes(room.leakage)) room.leakage = 'typical';
  // 028: множитель — число (строка проходила сравнение «> 0»)
  if (room.calibration && !(isNum(room.calibration.dampingScale) && room.calibration.dampingScale > 0)) room.calibration = null;
  if (room.calibration) room.calibration = dropBad(room.calibration, { source: (v) => typeof v === 'string' });
  // множитель, подобранный для прежней модели затухания, к новой не подходит — подстройку нужно повторить
  if (room.calibration && room.calibration.model !== DAMPING_MODEL) room.calibration = null;
  if (room.calibration && room.calibration.leakageBefore !== undefined && !['sealed', 'typical', 'door', 'open'].includes(room.calibration.leakageBefore)) {
    const { leakageBefore: _bad, ...rest } = room.calibration;
    void _bad;
    room.calibration = rest;
  }
  // 028: стена из четырёх, участок и высоты — числа; иначе проём или коридор убирается (без арки коридор раньше
  // ронял открытие проекта)
  room.openings = Array.isArray(room.openings)
    ? room.openings.filter((o: any) => isObj(o) && oneOf(WALLS, o.wall) && [o.a0, o.a1, o.height].every(isNum))
    : [];
  room.extensions = Array.isArray(room.extensions)
    ? room.extensions.filter((e: any) => isObj(e) && oneOf(WALLS, e.wall) && [e.a0, e.a1, e.depth, e.height].every(isNum)
      && isObj(e.arch) && [e.arch.a0, e.arch.a1, e.arch.height].every(isNum))
    : [];
  room.treatments = Array.isArray(room.treatments)
    ? room.treatments
      .filter((t: any) => t && ['corner', 'panel', 'cloud'].includes(t.kind) && [t.width, t.height, t.thickness].every(isNum) && t.width > 0 && t.height > 0 && t.thickness > 0)
      // 028: необязательные угол, стена, положение и зазор неверного типа убираются — читаются умолчания
      .map((t: any) => dropBad(t, { corner: (v) => oneOf(CORNERS, v), wall: (v) => oneOf(WALLS, v), at: isNum, z: isNum, x: isNum, y: isNum, gap: isNum }))
    : [];
  room.treatmentsOn = !!room.treatmentsOn;
  if (!room.slope || !oneOf(WALLS, room.slope.wall) || !(isNum(room.slope.low) && room.slope.low > 0) || !(isNum(room.slope.run) && room.slope.run > 0)) room.slope = null;
  room.features = Array.isArray(room.features)
    ? room.features.filter((f: any) => f && (f.kind === 'window' || f.kind === 'door') && ['front', 'back', 'left', 'right'].includes(f.wall) && f.a1 > f.a0)
    : [];
  if (!['auto', 'modal', 'wave'].includes(room.model)) room.model = 'auto';
  // 019: тип и высота мебели, ковры и шторы, обстановка по списку (необязательные поля)
  room.zones = room.zones.map((z: any) => {
    const n = { ...z };
    // 028: вид из четырёх (иначе «Другое» — место без колонок сохраняется), подпись — строка
    if (!oneOf(ZONE_KINDS, n.kind)) n.kind = 'other';
    if (n.name !== undefined && typeof n.name !== 'string') delete n.name;
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
    // 028: регулировки сабвуфера — своего типа, иначе как у сабвуфера по умолчанию
    if (n.kind === 'sub') {
      if (!oneOf(['none', 'adjustable'] as const, n.delayMode)) n.delayMode = d.delayMode;
      if (!oneOf(['none', 'polarity', 'continuous', 'full'] as const, n.phaseMode)) n.phaseMode = d.phaseMode;
      n.maxDelayMs = finite(n.maxDelayMs, d.maxDelayMs!);
      if (n.peqBands !== undefined && !isNum(n.peqBands)) delete n.peqBands;
    }
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
  // 028: подбор частоты раздела перебирает частоты от min до max — числа (строки склеивались бы в цикле)
  if (typeof constraints.crossover.adjustable !== 'boolean') constraints.crossover.adjustable = dc.crossover.adjustable;
  for (const k of ['min', 'max'] as const) constraints.crossover[k] = finite(constraints.crossover[k], dc.crossover[k]);
  const fixSetup = (s: any, name: string): Setup => {
    const d = defaultSetup(room, sources, constraints, name);
    return syncSetup(
      {
        ...d,
        ...(isObj(s) ? s : {}),
        // 028: id и имя — строки
        ...(typeof s?.id === 'string' ? {} : { id: d.id }),
        ...(typeof s?.name === 'string' ? {} : { name }),
        // координаты-не-числа (NaN в JSON становится null) — к местам по умолчанию
        ...(isPoint(s?.listener) ? {} : { listener: d.listener }),
        positions: Object.fromEntries(Object.entries(isObj(s?.positions) ? s.positions : {}).filter(([, v]) => isPoint(v))) as Setup['positions'],
        // 028: задержка, фаза, уровень и свои фильтры сабвуферов — числа; частота раздела — число или нет
        subSettings: cleanSubSettings(s?.subSettings),
        crossoverHz: isNum(s?.crossoverHz) ? s.crossoverHz : null,
        measurement: validMeasurement(s?.measurement) ? s.measurement : null,
        history: Array.isArray(s?.history) && s.history.some(validMeasurement) ? s.history.filter(validMeasurement).slice(0, HISTORY_MAX) : undefined,
      },
      room,
      sources,
      constraints,
    );
  };
  // 028: результат подбора неверной формы отбрасывается — подбор запускают заново, выбран первый вариант
  const result = cleanResult(raw.result);
  const dropped = raw.result != null && !result;
  return {
    id: typeof raw.id === 'string' ? raw.id : makeId(),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Комната',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    room,
    sources,
    constraints,
    scanInfo: normalizeScanInfo(raw.scanInfo),
    result,
    selectedIndex: !dropped && Number.isInteger(raw.selectedIndex) && raw.selectedIndex >= 0 ? raw.selectedIndex : 0,
    current: (() => {
      const cur = fixSetup(raw.current, 'Текущая');
      // 022: признак «места выбраны»; у проектов до 022 — по тому, стоят ли места по умолчанию
      return { ...cur, placed: typeof raw.current?.placed === 'boolean' ? raw.current.placed : legacyPlaced(cur, room, sources, constraints) };
    })(),
    // сохранённый вариант — всегда выбранные места (до 022 признака не было)
    setups: Array.isArray(raw.setups) ? raw.setups.filter(isObj).map((s: any) => ({ ...fixSetup(s, 'Вариант'), placed: true })) : [],
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

/**
 * 029: соединение с базой одно на вкладку. Раньше каждая операция открывала своё и не закрывала его, поэтому удаление
 * или смена версии базы в другой вкладке ждали эту вкладку («Хранилище занято…»). Теперь соединение закрывается при
 * versionchange и когда его закрыл сам браузер (close), а следующая операция открывает новое.
 */
let conn: Promise<IDBDatabase> | null = null;

/** Закрыть соединение; следующая операция откроет новое. */
function drop(db: IDBDatabase, from: Promise<IDBDatabase>) {
  if (conn === from) conn = null;
  try { db.close(); } catch { /* уже закрыто */ }
}

function open(): Promise<IDBDatabase> {
  if (conn) return conn;
  const p = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB недоступна'));
    // операция уже отклонена (ожидание закончилось «Хранилище занято…») — открывшееся позже соединение не нужно
    let settled = false;
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      if (!db.objectStoreNames.contains(SCANS)) db.createObjectStore(SCANS, { keyPath: 'projectId' });
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) { db.close(); return; }
      settled = true;
      db.onversionchange = () => drop(db, p);
      db.onclose = () => drop(db, p);
      resolve(db);
    };
    req.onerror = () => { settled = true; reject(req.error); };
    req.onblocked = () => { settled = true; reject(new Error('Хранилище занято другой вкладкой приложения — закройте её.')); };
  });
  conn = p;
  p.catch(() => { if (conn === p) conn = null; });
  return p;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, again = true): Promise<T> {
  const p = open();
  return p.then((db) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(store, mode);
    } catch (e) {
      // соединение закрыто, а браузер об этом не сообщил: один повтор с новым — как прежде с отдельным соединением
      drop(db, p);
      if (!again) throw e;
      return tx(store, mode, fn, false);
    }
    return new Promise<T>((resolve, reject) => {
      const req = fn(t.objectStore(store));
      req.onsuccess = () => resolve(req.result);
      // после ошибки следующая операция открывает новое соединение (так было, когда у каждой было своё)
      req.onerror = () => { drop(db, p); reject(req.error); };
    });
  });
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

/**
 * 029: прежний рабочий проект не открылся (loadDraft отклонён) — он не перезаписывается, пока пользователь не выбрал
 * «Начать новый проект» (releaseDraft) или повтор чтения не удался. Запрет — здесь, в одном месте для всех путей
 * записи: отложенное сохранение, сохранение при уходе со страницы и перед обновлением приложения.
 */
let draftKept = false;
/** Пользователь выбрал продолжить без прежнего рабочего проекта: запись черновика снова разрешена. */
export function releaseDraft(): void {
  draftKept = false;
}

/** Черновик текущего проекта — восстанавливается при следующем запуске. */
export const saveDraft = (p: Project) => draftKept
  ? Promise.reject(new Error('Прежний рабочий проект не открылся — черновик не перезаписывается'))
  : tx(META, 'readwrite', (s) => s.put(JSON.parse(JSON.stringify(p)), 'draft'));
/**
 * Несохранённый проект на момент ухода со страницы. Отложенное сохранение (300 мс после последнего изменения)
 * могло не успеть, а запись в IndexedDB при закрытии страницы браузер не гарантирует; localStorage пишется
 * синхронно. При запуске такая запись важнее сохранённого черновика.
 */
const PENDING_KEY = 'ra-draft-pending';
export function stashPendingDraft(p: Project): void {
  // 029: запись важнее черновика — пока прежний не открылся, она заслонила бы его при следующем запуске
  if (draftKept) return;
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

/**
 * 029: рабочий проект есть, но не открылся. unreadable — хранилище не читается и после повторов; invalid — черновик
 * не прошёл проверку (raw — его данные как есть, error — причина из проверки). Черновик на устройстве не тронут.
 */
export class DraftLoadError extends Error {
  constructor(readonly kind: 'unreadable' | 'invalid', readonly error: unknown, readonly raw?: unknown) {
    super(error instanceof Error ? error.message : String(error));
    this.name = 'DraftLoadError';
  }
}

/** 029: паузы между попытками прочитать черновик — до четырёх попыток, около 1,4 с: такие сбои обычно кратковременны. */
export const DRAFT_READ_PAUSES: readonly number[] = [200, 400, 800];
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Рабочий проект при запуске (029 — три исхода): проект — открыт; undefined — черновика нет (первый запуск);
 * DraftLoadError — черновик есть, но не открылся: до решения пользователя он не перезаписывается (releaseDraft).
 */
export async function loadDraft(pauses: readonly number[] = DRAFT_READ_PAUSES): Promise<Project | undefined> {
  // запись при уходе со страницы появляется только когда на устройстве состояние старее, и удаляется, как только оно
  // сохранено. Она читается независимо от IndexedDB: исправная открывается, даже если база не читается.
  const pending = readPendingDraft();
  if (pending) {
    try { return opened(normalizeProject(pending)); } catch { /* повреждена — берём сохранённый */ }
  }
  // браузера без IndexedDB черновик не касается: на устройстве его нет — ни прочитать, ни перезаписать
  if (typeof indexedDB === 'undefined') return opened(undefined);
  let stored: unknown;
  for (let attempt = 0; ; attempt++) {
    try {
      stored = await tx<unknown>(META, 'readonly', (s) => s.get('draft'));
      break;
    } catch (e) {
      if (attempt >= pauses.length) {
        draftKept = true;
        throw new DraftLoadError('unreadable', e);
      }
      await pause(pauses[attempt]);
    }
  }
  if (!stored) return opened(undefined);
  try {
    return opened(normalizeProject(stored));
  } catch (e) {
    draftKept = true;
    // копия остаётся на устройстве и под ключом draft-failed (как раньше)
    await tx(META, 'readwrite', (s) => s.put(stored, 'draft-failed')).catch(() => undefined);
    throw new DraftLoadError('invalid', e, stored);
  }
}
/** Черновик открыт или его нет — запись снова разрешена (в том числе после удачного «Повторить»). */
function opened<T>(v: T): T {
  draftKept = false;
  return v;
}

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
