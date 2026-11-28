// V2-047: профили оборудования и материалов — версии, применение к экземпляру, состояние экземпляра, оценка паспорта
// по свободнополевой АЧХ (комнатная — отказ), свой материал: ближайший справочный для ядра с сообщением, α профиля в
// расчётах v2, различия конфигураций.
import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../../src/core/materials';
import { toCore } from '../../src/v2/adapters/core';
import { reflectionPaths } from '../../src/v2/application/analysis';
import { patchSource } from '../../src/v2/application/editing';
import { diffConfigs } from '../../src/v2/application/experiment';
import {
  applyEquipment, applyMaterial, blankEquipment, blankMaterial, currentData, equipmentIssues, equipmentOf, instanceState, materialIssues, materialState,
  nearestBuiltin, newProfile, parseResponse, passportFromResponse, restoreVersion, revise, surfaceAlpha,
} from '../../src/v2/application/profiles';
import { buildRoom, DEFAULT_NEW_ROOM } from '../../src/v2/application/rooms';
import type { RoomConfiguration } from '../../src/v2/domain/model';
import type { EquipmentData, MeasuredResponse } from '../../src/v2/domain/profiles';

const NOW = '2026-11-28T10:00:00.000Z', LATER = '2026-11-29T10:00:00.000Z';
let n = 0;
const id = () => `id${++n}`;
const config = (): RoomConfiguration => buildRoom({ ...DEFAULT_NEW_ROOM, name: 'Тест', depth: 5, width: 4, height: 2.5, layout: '2.1' }, id, NOW).current;
const sub = (c: RoomConfiguration) => c.audio.sources.find((s) => s.kind === 'sub')!;
const speaker = (c: RoomConfiguration) => c.audio.sources.find((s) => s.kind === 'speaker')!;
const subData = (patch: Partial<EquipmentData> = {}): EquipmentData => ({ ...blankEquipment('sub'), source: 'паспорт', fLow: 22, passport: { f3: 25, box: 'sealed' }, ...patch });

/** АЧХ фильтра высоких частот 2-го порядка (Баттерворт): −3 дБ на fc, −10 дБ на fc·(1/9)^¼. */
function highpass(fc: number, field: MeasuredResponse['field']): MeasuredResponse {
  const f: number[] = [], db: number[] = [];
  for (let x = 10; x <= 20000; x *= 2 ** (1 / 24)) { const r = (x / fc) ** 4; f.push(x); db.push(10 * Math.log10(r / (1 + r))); }
  return { f, db, field, distance: 1, reference: '2,83 В / 1 м', source: 'тест', fileName: 'hp.txt', importedAt: NOW };
}

describe('профили оборудования (V2-047)', () => {
  it('версии: без изменений — та же версия, переименование — без версии, изменение и восстановление — новые версии', () => {
    const p = newProfile('Саб', subData(), 'p1', NOW);
    expect(p.version).toBe(1);
    expect(revise(p, subData(), LATER, '')).toBe(p);
    const renamed = revise(p, subData(), LATER, '', 'Саб 12"');
    expect([renamed.name, renamed.version]).toEqual(['Саб 12"', 1]);
    const v2 = revise(p, subData({ fLow: 18 }), LATER, 'Новый паспорт');
    expect([v2.version, v2.versions[1].note, currentData(v2).fLow]).toEqual([2, 'Новый паспорт', 18]);
    const v3 = restoreVersion(v2, 1, LATER);
    expect([v3.version, currentData(v3).fLow, v3.versions[2].note]).toEqual([3, 22, 'Восстановлена версия 1']);
  });

  it('применение к экземпляру: копия версии со ссылкой; вид должен совпадать; состояние — актуален, есть новая версия, изменён, удалён', () => {
    const c = config();
    const p = newProfile('Саб', subData(), 'p1', NOW);
    const applied = applyEquipment(c, sub(c).id, p);
    const s = sub(applied);
    expect([s.fLow, s.passport, s.profile]).toEqual([22, { f3: 25, box: 'sealed' }, { id: 'p1', version: 1 }]);
    expect(instanceState(s, p)).toBe('current');
    expect(() => applyEquipment(c, speaker(c).id, p)).toThrow(/нельзя применить к колонке/);
    const v2 = revise(p, subData({ fLow: 18 }), LATER, '');
    expect(instanceState(s, v2)).toBe('outdated');
    expect(sub(applied).fLow).toBe(22);
    const edited = sub(patchSource(applied, s.id, { fLow: 30 }));
    expect(instanceState(edited, v2)).toBe('modified');
    expect(instanceState(s, undefined)).toBe('missing');
    expect(instanceState(sub(c), p)).toBe('none');
    // сохранить экземпляр как профиль и связать — актуален
    const own = newProfile('Мой', equipmentOf(sub(c)), 'p2', NOW);
    const linked = sub(patchSource(c, sub(c).id, { profile: { id: 'p2', version: 1 } }));
    expect(instanceState(linked, own)).toBe('current');
  });

  it('проверка данных: диапазон, спады, источник, направленность', () => {
    expect(equipmentIssues(subData())).toEqual([]);
    expect(equipmentIssues(subData({ fLow: 300, fHigh: 200 })).join(' ')).toMatch(/Диапазон/);
    expect(equipmentIssues(subData({ passport: { f3: 25, f10: 30 } })).join(' ')).toMatch(/−10 дБ/);
    expect(equipmentIssues(subData({ source: ' ' })).join(' ')).toMatch(/источник/);
    expect(equipmentIssues(subData({ directivity: { kind: 'parametric', aboveHz: 1000, beamDeg: 10 } })).join(' ')).toMatch(/Направленность/);
  });

  it('АЧХ из файла и оценка паспорта только по свободнополевой характеристике', () => {
    const csv = ['Freq;SPL', ...Array.from({ length: 12 }, (_, k) => `${20 * 2 ** k};${(80 + k / 10).toFixed(1).replace('.', ',')}`)].join('\n');
    const r = parseResponse(csv);
    expect([r.f.length, r.f[0], r.db[1]]).toEqual([11, 20, 80.1]);
    expect(() => parseResponse('20 80\n40 81')).toThrow(/меньше 10 точек/);
    const est = passportFromResponse(highpass(50, 'anechoic'), 'speaker');
    expect(est.f3).toBeCloseTo(50, 0);
    expect(est.f10).toBeCloseTo(50 * (1 / 9) ** 0.25, 0);
    expect(passportFromResponse(highpass(50, 'room'), 'speaker')).toEqual({ reason: expect.stringMatching(/Комнатная АЧХ/) });
    expect(passportFromResponse(highpass(50, 'unknown'), 'speaker').reason).toMatch(/неизвестны/);
    const flat = highpass(1, 'near-field');
    const none = passportFromResponse(flat, 'speaker');
    expect([none.f3, none.reason]).toEqual([undefined, expect.stringMatching(/неизвестна/)]);
  });

  it('параметрическая направленность — ограничение расчёта ядра', () => {
    const c = config();
    const d = applyEquipment(c, speaker(c).id, newProfile('Монитор', { ...blankEquipment('speaker'), source: 'паспорт', directivity: { kind: 'parametric', aboveHz: 1000, beamDeg: 90 } }, 'p3', NOW));
    const core = toCore(d);
    expect(core.ok && core.limitations.join(' ')).toMatch(/Направленность источников в расчёт ядра не входит/);
  });
});

describe('профили материалов (V2-047)', () => {
  it('ближайший справочный материал: свой α → он же; проверка данных', () => {
    for (const m of MATERIALS) expect(nearestBuiltin(m.alpha)).toEqual({ id: m.id, name: m.name, maxDiff: 0 });
    expect(materialIssues(blankMaterial())).toEqual([expect.stringMatching(/источник/)]);
    expect(materialIssues({ ...blankMaterial(), source: 'ISO 354', alpha: [0, 0, 0, 1.2, 0, 0, 0] }).join(' ')).toMatch(/от 0 до 1/);
  });

  it('свой материал: в ядро — ближайший справочный с сообщением, в расчётах v2 — α профиля, в различиях — название', () => {
    const c = config();
    const alpha = [0.1, 0.3, 0.6, 0.9, 0.95, 0.95, 0.9];
    const p = newProfile('Войлок 40 мм', { alpha, uncertainty: 0.05, source: 'паспорт', basedOn: null }, 'm1', NOW);
    const d = applyMaterial(c, 'left', p);
    expect(d.surfaces.left.material).toBe(nearestBuiltin(alpha).id);
    expect(d.surfaces.left.profile).toEqual({ id: 'm1', version: 1, name: 'Войлок 40 мм', alpha, uncertainty: 0.05, source: 'паспорт' });
    expect(surfaceAlpha(d.surfaces.left)).toEqual(alpha);
    const core = toCore(d);
    expect(core.ok && core.limitations.join(' ')).toMatch(/Левая стена: свой материал «Войлок 40 мм» ядро не знает — в расчёте ядра ближайший справочный/);
    const left = (cfg: RoomConfiguration) => reflectionPaths(cfg).find((r) => r.surface === 'left')!;
    expect(left(d).levelDb).toBeCloseTo(left(c).levelDb + 10 * Math.log10(1 - 0.95) - 10 * Math.log10(1 - surfaceAlpha(c.surfaces.left)[4]), 6);
    expect(diffConfigs(c, d).map((x) => x.text).join(' ')).toMatch(/Войлок 40 мм \(свой, в\. 1\)/);
    expect(materialState(d.surfaces.left, revise(p, { alpha: alpha.map((a) => a * 0.9), uncertainty: 0.05, source: 'паспорт', basedOn: null }, LATER, ''))).toBe('outdated');
    expect(materialState(c.surfaces.left, p)).toBe('none');
  });
});
