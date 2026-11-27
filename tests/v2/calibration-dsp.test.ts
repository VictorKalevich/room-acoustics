// V2-049, пакет 10г-2: подстройка модели по замеру (множитель и герметичность, сброс возвращает прежнюю), коррекция
// комнаты в конфигурации и в различиях конфигураций, список устройств ввода и вывода.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DAMPING_MODEL } from '../../src/core/types';
import { applyProposal, diffConfigs } from '../../src/v2/application/experiment';
import { applyCalibration, resetCalibration, setRoomDsp } from '../../src/v2/application/measure';
import { buildRoom, DEFAULT_NEW_ROOM } from '../../src/v2/application/rooms';
import type { RoomDsp } from '../../src/v2/domain/model';
import { listDevices } from '../../src/v2/shared/audio';

const NOW = '2026-11-28T10:00:00.000Z';
let n = 0;
const id = () => `id${++n}`;
const room = () => buildRoom({ ...DEFAULT_NEW_ROOM, name: 'Тест', depth: 5, width: 4, height: 2.5, layout: '2.1' }, id, NOW);

describe('подстройка модели по замеру (V2-049)', () => {
  it('множитель и герметичность; повторная подстройка помнит исходную герметичность; сброс её возвращает', () => {
    const c = { ...room().current, simulation: { ...room().current.simulation, leakage: 'typical' as const } };
    const a = applyCalibration(c, { dampingScale: 1.6, leakage: 'door', rmsBefore: 4, rmsAfter: 2 }, 'Свип 1');
    expect(a.simulation.leakage).toBe('door');
    expect(a.simulation.calibration).toEqual({ dampingScale: 1.6, model: DAMPING_MODEL, source: 'Свип 1', leakageBefore: 'typical' });
    const b = applyCalibration(a, { dampingScale: 1.2, leakage: 'open', rmsBefore: 2, rmsAfter: 1.5 }, 'Свип 2');
    expect(b.simulation.calibration?.leakageBefore).toBe('typical');
    const r = resetCalibration(b);
    expect([r.simulation.calibration, r.simulation.leakage]).toEqual([null, 'typical']);
    expect(resetCalibration(c).simulation.leakage).toBe('typical');
    expect(diffConfigs(c, a).map((x) => x.text)).toEqual(expect.arrayContaining(['Герметичность комнаты', 'Подстройка по замеру']));
  });

  it('применение в эксперимент: текущая не меняется', () => {
    const r = room();
    const next = applyProposal(r, (x) => applyCalibration(x, { dampingScale: 2, leakage: 'sealed', rmsBefore: 5, rmsAfter: 3 }, 'Свип'), id, NOW);
    expect(next.current).toEqual(r.current);
    expect(next.experimental?.simulation.calibration?.dampingScale).toBe(2);
  });
});

describe('коррекция комнаты в конфигурации (V2-049)', () => {
  const dsp = (gain: number, on = true): RoomDsp => ({
    filters: [{ id: 'f1', type: 'peaking', f: 45, gainDb: gain, q: 4, enabled: true }, { id: 'f2', type: 'peaking', f: 90, gainDb: -3, q: 3, enabled: on }],
    preamp: 0, source: 'замеру «Свип»', scenario: 'cut', savedAt: NOW,
  });
  it('сохраняется, меняется и убирается; различия конфигураций это показывают', () => {
    const c = room().current;
    const a = setRoomDsp(c, dsp(-6));
    expect(a.dsp?.filters).toHaveLength(2);
    expect(diffConfigs(c, a).map((x) => x.text)).toContain('Сохранена коррекция комнаты: фильтров 2');
    expect(diffConfigs(a, setRoomDsp(a, dsp(-6, false))).map((x) => x.text)).toContain('Коррекция комнаты изменена: фильтров 2 → 1');
    expect(diffConfigs(a, setRoomDsp(a, null)).map((x) => x.text)).toContain('Коррекция комнаты убрана');
    expect(diffConfigs(c, setRoomDsp(c, null))).toEqual([]);
  });
});

describe('устройства (V2-049)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('микрофоны и выходы без «по умолчанию»; без названий — номера; выбор выхода — только если браузер умеет', async () => {
    vi.stubGlobal('navigator', { mediaDevices: { enumerateDevices: async () => [
      { kind: 'audioinput', deviceId: 'default', label: 'По умолчанию' },
      { kind: 'audioinput', deviceId: 'mic-a', label: 'USB Mic' },
      { kind: 'audioinput', deviceId: 'mic-b', label: '' },
      { kind: 'audiooutput', deviceId: 'out-a', label: 'Колонки' },
      { kind: 'videoinput', deviceId: 'cam', label: 'Камера' },
      { kind: 'audioinput', deviceId: '', label: '' },
    ] } });
    const d = await listDevices();
    expect(d.inputs).toEqual([{ id: 'mic-a', label: 'USB Mic' }, { id: 'mic-b', label: 'Микрофон 2' }]);
    expect(d.outputs).toEqual([{ id: 'out-a', label: 'Колонки' }]);
    expect(d.canChooseOutput).toBe(false);
    class Ctx { setSinkId() { return Promise.resolve(); } }
    vi.stubGlobal('AudioContext', Ctx);
    expect((await listDevices()).canChooseOutput).toBe(true);
  });
});
