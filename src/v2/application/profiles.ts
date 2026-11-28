// Профили оборудования и материалов (V2-047): версии, применение к экземпляру в комнате, состояние экземпляра
// относительно профиля, оценка паспорта по свободнополевой АЧХ и ближайший справочный материал для ядра.
import { OCTAVES, getMaterial } from '../../core/materials';
import { nearestBuiltin } from '../adapters/materials';
import type { SurfaceId } from '../../core/types';
import type { ProfileRef, RoomConfiguration, Source, SurfaceMaterial } from '../domain/model';
import type { EquipmentData, EquipmentProfile, MaterialData, MaterialProfile, MeasuredResponse, Profile, ResponseField } from '../domain/profiles';
import { patchSource } from './editing';

export { nearestBuiltin };

export { OCTAVES };

export const FIELD_LABEL: Record<ResponseField, string> = {
  anechoic: 'Безэховая камера', 'quasi-anechoic': 'Квазибезэховая (стробирование)', 'near-field': 'Ближнее поле', room: 'В комнате', unknown: 'Неизвестно',
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function newProfile<T>(name: string, data: T, id: string, now: string, note = 'Создан'): Profile<T> {
  return { id, name: name.trim() || 'Без названия', createdAt: now, updatedAt: now, version: 1, versions: [{ version: 1, at: now, note, data: structuredClone(data) }] };
}

export const currentData = <T>(p: Profile<T>): T => p.versions[p.versions.length - 1].data;
export const dataAt = <T>(p: Profile<T>, v: number): T | null => p.versions.find((x) => x.version === v)?.data ?? null;

/** Новая версия, если данные изменились; переименование версию не создаёт. */
export function revise<T>(p: Profile<T>, data: T, now: string, note: string, name = p.name): Profile<T> {
  const named = name.trim() && name.trim() !== p.name ? { ...p, name: name.trim(), updatedAt: now } : p;
  if (same(currentData(p), data)) return named;
  const version = p.version + 1;
  return { ...named, updatedAt: now, version, versions: [...p.versions, { version, at: now, note: note.trim() || `Версия ${version}`, data: structuredClone(data) }] };
}

export function restoreVersion<T>(p: Profile<T>, v: number, now: string): Profile<T> {
  const d = dataAt(p, v);
  if (!d) throw new Error(`Версии ${v} нет.`);
  return revise(p, d, now, `Восстановлена версия ${v}`);
}

// ---------- Оборудование ----------

export function equipmentIssues(d: EquipmentData): string[] {
  const out: string[] = [];
  if (!(d.fLow >= 5 && d.fHigh <= 40000 && d.fLow < d.fHigh)) out.push('Диапазон: нижняя граница от 5 Гц меньше верхней (до 40 кГц).');
  const p = d.passport;
  if (p?.f3 !== undefined && !(p.f3 > 0)) out.push('Частота спада −3 дБ должна быть больше нуля.');
  if (p?.f3 !== undefined && p.f10 !== undefined && !(p.f10 < p.f3)) out.push('Частота −10 дБ должна быть ниже частоты −3 дБ.');
  if (d.box && !(d.box.w > 0 && d.box.h > 0 && d.box.d > 0)) out.push('Размеры корпуса — больше нуля.');
  if (d.directivity.kind === 'parametric' && !(d.directivity.beamDeg >= 20 && d.directivity.beamDeg <= 360 && d.directivity.aboveHz >= 100)) {
    out.push('Направленность: ширина диаграммы 20–360°, частота начала от 100 Гц.');
  }
  if (!d.source.trim()) out.push('Укажите источник данных: паспорт производителя, свой замер или оценка.');
  return out;
}

/** Данные экземпляра как данные профиля (для «Сохранить как профиль» и сравнения с версией). */
export function equipmentOf(s: Source, source = 'Экземпляр в комнате'): EquipmentData {
  const box = s.box && !('missing' in s.box) ? { ...s.box } : null;
  return {
    kind: s.kind, maker: '', model: '', fLow: s.fLow, fHigh: s.fHigh, passport: s.passport ? { ...s.passport } : null,
    capabilities: { ...s.capabilities }, box, directivity: s.directivity ?? { kind: 'omni' }, response: null, source,
  };
}

/** Поля экземпляра, которые задаёт профиль. */
const instanceFields = (d: EquipmentData) => ({ fLow: d.fLow, fHigh: d.fHigh, passport: d.passport ?? undefined, capabilities: d.capabilities, box: d.box ?? undefined, directivity: d.directivity });

export function applyEquipment(c: RoomConfiguration, sourceId: string, p: EquipmentProfile, version = p.version): RoomConfiguration {
  const s = c.audio.sources.find((x) => x.id === sourceId);
  const d = dataAt(p, version);
  if (!s || !d) throw new Error('Источник или версия профиля не найдены.');
  if (s.kind !== d.kind) throw new Error(`Профиль ${d.kind === 'sub' ? 'сабвуфера' : 'колонки'} нельзя применить к ${s.kind === 'sub' ? 'сабвуферу' : 'колонке'}.`);
  const issues = equipmentIssues(d);
  if (issues.length) throw new Error(issues.join(' '));
  const ref: ProfileRef = { id: p.id, version };
  return patchSource(c, sourceId, { ...structuredClone(instanceFields(d)), profile: ref });
}

export type InstanceState = 'none' | 'missing' | 'current' | 'outdated' | 'modified';

/** Экземпляр и его профиль: нет ссылки, профиль удалён, совпадает, есть новая версия, изменён в комнате. */
export function instanceState(s: Source, p: EquipmentProfile | undefined): InstanceState {
  if (!s.profile) return 'none';
  const d = p && dataAt(p, s.profile.version);
  if (!p || !d) return 'missing';
  const mine = instanceFields(equipmentOf(s));
  if (!same(mine, JSON.parse(JSON.stringify(instanceFields(d))))) return 'modified';
  return p.version > s.profile.version ? 'outdated' : 'current';
}

/**
 * Разбор АЧХ оборудования: пары «частота, дБ» по строкам (REW, CSV, табуляция), 10 Гц – 40 кГц. Не меньше 10 точек;
 * сглаживание и пересчёт не выполняются — сохраняются исходные точки.
 */
export function parseResponse(text: string): { f: number[]; db: number[] } {
  const pts: [number, number][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^[*#"a-zA-Zа-яА-Я]/.test(line)) continue;
    let tokens = line.split(/[\s;\t]+/).filter(Boolean);
    if (tokens.length < 2) tokens = line.split(',');
    const [f, db] = tokens.map((t) => Number(t.replace(',', '.')));
    if (Number.isFinite(f) && Number.isFinite(db) && f >= 10 && f <= 40000) pts.push([f, db]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const uniq = pts.filter((p, i) => i === 0 || p[0] > pts[i - 1][0]);
  if (uniq.length < 10) throw new Error('В файле меньше 10 точек «частота, дБ» в диапазоне 10 Гц – 40 кГц.');
  return { f: uniq.map((p) => p[0]), db: uniq.map((p) => p[1]) };
}

/**
 * Оценка частот спада −3 и −10 дБ по АЧХ: опора — медиана уровня в полосе 200–2000 Гц (колонка) или 40–80 Гц
 * (сабвуфер), спад — первое пересечение уровня ниже полосы, с интерполяцией по логарифму частоты. Только для
 * свободнополевых условий: комнатная АЧХ отражает комнату, а не громкоговоритель. Нет пересечения — частота неизвестна.
 */
export function passportFromResponse(r: MeasuredResponse, kind: EquipmentData['kind']): { f3?: number; f10?: number; reason?: string } {
  if (r.field === 'room') return { reason: 'Комнатная АЧХ не считается свободнополевой характеристикой громкоговорителя: паспорт по ней не оценивается.' };
  if (r.field === 'unknown') return { reason: 'Условия замера неизвестны: укажите, безэховый, стробированный или ближнего поля замер.' };
  const [lo, hi] = kind === 'sub' ? [40, 80] : [200, 2000];
  const band = r.db.filter((_, i) => r.f[i] >= lo && r.f[i] <= hi).sort((a, b) => a - b);
  if (band.length < 3) return { reason: `В АЧХ мало точек в опорной полосе ${lo}–${hi} Гц.` };
  const ref = band[Math.floor(band.length / 2)];
  const cross = (drop: number): number | undefined => {
    let k = r.f.findIndex((f) => f >= lo);
    for (; k > 0; k--) {
      const a = r.db[k], b = r.db[k - 1];
      if (b < ref - drop && a >= ref - drop) {
        const t = (a - (ref - drop)) / (a - b);
        return Math.round(Math.exp(Math.log(r.f[k]) + t * (Math.log(r.f[k - 1]) - Math.log(r.f[k]))) * 10) / 10;
      }
    }
    return undefined;
  };
  const f3 = cross(3), f10 = cross(10);
  return { ...(f3 !== undefined ? { f3 } : {}), ...(f10 !== undefined ? { f10 } : {}), ...(f3 === undefined ? { reason: 'Спада на 3 дБ ниже опорной полосы в данных нет: частота неизвестна.' } : {}) };
}

// ---------- Материалы ----------

export function materialIssues(d: MaterialData): string[] {
  const out: string[] = [];
  if (d.alpha.length !== OCTAVES.length || d.alpha.some((a) => !(a >= 0 && a <= 1))) out.push('α по октавам 63–4000 Гц — от 0 до 1.');
  if (d.uncertainty !== null && !(d.uncertainty >= 0 && d.uncertainty <= 0.5)) out.push('Неопределённость — от 0 до 0,5.');
  if (!d.source.trim()) out.push('Укажите источник данных: паспорт, измерение в реверберационной камере, справочник.');
  return out;
}

export function applyMaterial(c: RoomConfiguration, surface: SurfaceId, p: MaterialProfile, version = p.version): RoomConfiguration {
  const d = dataAt(p, version);
  if (!d) throw new Error('Версия профиля не найдена.');
  const issues = materialIssues(d);
  if (issues.length) throw new Error(issues.join(' '));
  const near = nearestBuiltin(d.alpha);
  const sm: SurfaceMaterial = { material: near.id, profile: { id: p.id, version, name: p.name, alpha: [...d.alpha], uncertainty: d.uncertainty, source: d.source } };
  return { ...c, surfaces: { ...c.surfaces, [surface]: sm } };
}

/** α поверхности по октавам: свой материал — по профилю, иначе справочник ядра. */
export const surfaceAlpha = (sm: SurfaceMaterial): readonly number[] => sm.profile?.alpha ?? getMaterial(sm.material).alpha;

export const surfaceName = (sm: SurfaceMaterial): string => (sm.profile ? `${sm.profile.name} (свой, в. ${sm.profile.version})` : getMaterial(sm.material).name);

export function materialState(sm: SurfaceMaterial, p: MaterialProfile | undefined): InstanceState {
  if (!sm.profile) return 'none';
  const d = p && dataAt(p, sm.profile.version);
  if (!p || !d) return 'missing';
  if (!same(d.alpha, sm.profile.alpha)) return 'modified';
  return p.version > sm.profile.version ? 'outdated' : 'current';
}

export const blankMaterial = (basedOn: string | null = 'plaster'): MaterialData => ({
  alpha: [...getMaterial(basedOn ?? 'plaster').alpha], uncertainty: null, source: '', basedOn,
});

export const blankEquipment = (kind: EquipmentData['kind']): EquipmentData => ({
  kind, maker: '', model: '', fLow: kind === 'sub' ? 20 : 45, fHigh: kind === 'sub' ? 200 : 20000, passport: null,
  capabilities: kind === 'sub' ? { delayMode: 'adjustable', phaseMode: 'continuous', levelAdjustable: true, peqBands: 0 } : {},
  box: null, directivity: { kind: 'omni' }, response: null, source: '',
});
