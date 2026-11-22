import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { MicProfile, MicScope } from '../../src/core/micCalibration';
import { checkCurve, correctionFunction, parseMicFile, powerGains } from '../../src/core/micCurve';
import { defaultInput, micCatalog } from '../../src/state/micCatalog';
import { absoluteOffset, referenceLevel } from '../../src/core/micReference';
import { NoiseMeter, type NoisePoint } from '../../src/core/noise';
import { calAt, parseCalibration } from '../../src/core/dsp';

const profile: MicProfile = {
  id: 'test', version: 1, name: 'Fixture', deviceModel: 'Test', inputKind: 'unknown', captureMode: 'Test', orientation: null,
  origin: 'user', sourceURL: null, sourceDate: null, method: 'Synthetic', curve: { kind: 'response', frequencyHz: [100,1000,10000], responseDb: [-20,2,8] },
  referenceHz: 1000, validRangeHz: [100,10000], digitizationUncertaintyDb: null, validationStatus: 'unverified', notes: '', directivitySource: null,
};
const correction: MicProfile = { ...profile, curve: { kind: 'correction', frequencyHz: [100,10000], correctionDb: [6,6] } };
const noise: MicScope = { tool: 'noise' };
const rta: MicScope = { tool: 'rta', projectId: 'A' };
const selection = { mode: 'catalog', profileId: profile.id, version: 1 } as const;
beforeEach(() => vi.stubGlobal('indexedDB', new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());

it('strict Hz/dB input, FRD phase, decimal comma, units and ordering', () => {
  expect(parseMicFile('\uFEFF# mic\r\nHz,dB\n20,-2\n1000,0')).toEqual({ f: [20,1000], db: [-2,0] });
  expect(parseMicFile('* mic\n20,5  -2,5  30\n1000;0;0').db).toEqual([-2.5,0]);
  for (const bad of ['Hz,Pa\n20,1\n1000,2', '10,1\n10,2','0,1\n2,3','10,1\n5,2','10,,3\n20,0',
    '20,2\nNaN,3', '20,2\n1000,Infinity', '20,2\n1000,2,bad','20,\n40,4','20,2']) expect(() => parseMicFile(bad)).toThrow();
  expect(() => checkCurve([1,2], [1])).toThrow();
});

it('normalizes response at 1 kHz, interpolates logarithmically, caps boost, leaves unknown bins raw', () => {
  const at = correctionFunction(profile);
  expect(at(100)).toBe(12);
  expect(at(Math.sqrt(100 * 1000))).toBeCloseTo(11, 10);
  expect(at(1000)).toBe(0);
  expect(at(10000)).toBe(-6);
  expect(at(50)).toBeNull();
  expect(at(10001)).toBeNull();
  expect(powerGains(correction, 100, 12)[10]).toBeCloseTo(10 ** 0.6, 12);
  expect(powerGains(profile, 100, 12)[0]).toBe(1);
  expect(() => correctionFunction({ ...profile, validRangeHz: [2000,8000] })).toThrow();
});

it('keeps raw RMS, peak, history, PSD, LTAS and A/C/Z independent of a spectral correction', () => {
  const meter = new NoiseMeter(48000, correction);
  const raw = new NoiseMeter(48000);
  for (let n = 0; n < 12; n++) {
    const block = Float32Array.from({ length: 4096 }, (_, i) => 0.4 * Math.sin(2*Math.PI*(i + 4096*n)*1000/48000));
    raw.push(block,n,0); meter.push(block,n,0);
  }
  expect(meter.history).toEqual(raw.history);
  expect(meter.sessionPower).toBe(raw.sessionPower);
  for (const weight of ['A','C','Z'] as const) for (const period of ['now','10','60','session'] as const) {
    const base = raw.spectral.average(period,weight);
    const corrected = meter.spectral.average(period,weight,true);
    expect(corrected.seconds).toBe(base.seconds);
    expect(10*Math.log10(corrected.density[683]/base.density[683])).toBeCloseTo(6, 10);
    expect(meter.spectral.average(period,weight).density[683]).toBe(base.density[683]);
  }
});

it('stores immutable versions separately from scoped selections, protects references and concurrent writes', async () => {
  await micCatalog.saveVersion(profile);
  expect(await micCatalog.readSelection(noise)).toEqual({ mode: 'none' });
  expect(await micCatalog.readSelection(rta)).toEqual({ mode: 'legacy' });
  await Promise.all([micCatalog.select(rta, selection), micCatalog.select(noise,selection)]);
  const other = { ...rta, projectId: 'B' };
  expect(await micCatalog.readSelection(other)).toEqual({mode:'legacy'});
  expect(await micCatalog.readSelection({ tool:'sweep', projectId:'A' })).toEqual({mode:'legacy'});
  const v2 = { ...correction, version: 2, name:'Revised' };
  const writes = await Promise.allSettled([micCatalog.saveVersion(v2), micCatalog.saveVersion(v2)]);
  expect(writes.filter(v => v.status === 'fulfilled')).toHaveLength(1);
  expect(await micCatalog.readSelection(noise)).toEqual(selection);
  await expect(micCatalog.archive(profile, [noise])).rejects.toThrow();
  await micCatalog.select(rta,{mode:'legacy'});
  await micCatalog.archive(profile, [noise]);
  expect(await micCatalog.readSelection(noise)).toEqual(selection);
  await expect(micCatalog.select(other,selection)).rejects.toThrow();
  expect(await micCatalog.list()).toEqual([v2]);
  expect(await micCatalog.nextVersion(profile.id)).toBe(3);
  await expect(micCatalog.saveVersion({ ...profile, id:'faber', origin:'builtin' })).rejects.toThrow();
});

it('keeps absolute context scoped to an explicitly selected physical input', async () => {
  const input = { ...defaultInput(), source: {localDeviceId:'usb'} };
  const absolute = { offsetDb: 95, physicalInput:'usb', captureMode:'test', verifiedAt:'2026-11-22' };
  await micCatalog.saveInput(noise,input);
  await micCatalog.saveAbsolute(noise,input,absolute);
  expect((await micCatalog.readInput(noise)).absoluteCalibration).toEqual(absolute);
  expect((await micCatalog.readInput(rta)).absoluteCalibration).toBeNull();
  await expect(micCatalog.saveInput(rta,{ ...defaultInput(), absoluteCalibration:absolute })).rejects.toThrow();
  await expect(micCatalog.saveAbsolute(noise,input,null)).rejects.toThrow();
});

it('rejects unstable, short, discontinuous or nonlinear 1 kHz reference readings', () => {
  // Точки A как в history: проверяется только отбор последних 5 с.
  const meter = { sampleRate: 48000, history: [] as NoisePoint[] };
  const row = { endSeconds:0, rmsDbfs:-40, rms1sDbfs:-40, windowComplete:true, peakHz:996, clipped:false, missingBefore:0 };
  expect(referenceLevel(meter)).toBeNull();
  meter.history.push(...Array.from({length:60}, () => ({...row})));
  expect(referenceLevel(meter)).toBeCloseTo(-40, 9);
  for (const change of [{ missingBefore:1 },{clipped:true},{peakHz:250},{rmsDbfs:-35}]) {
    meter.history[meter.history.length - 1] = { ...row, ...change };
    expect(referenceLevel(meter)).toBeNull();
  }
  const first = { referenceSpl:60, measuredDbfs:-40 };
  expect(absoluteOffset(first, { referenceSpl:70, measuredDbfs:-30 })).toBe(100);
  expect(() => absoluteOffset(first, { referenceSpl:70, measuredDbfs:-34 })).toThrow();
});

it('preserves legacy parser, sign and edge behavior across catalog operations', async () => {
  const file = '20 1\n100 3\n500 5';
  const legacy = parseCalibration(file);
  const f = [10,20,Math.sqrt(2000),100,1000];
  const oldSweep = () => f.map(hz => 80 - calAt(legacy,hz));
  const before = oldSweep();
  await micCatalog.saveVersion(correction);
  await micCatalog.select(rta,selection);
  await micCatalog.select(rta,{mode:'none'});
  await micCatalog.select(rta,{mode:'legacy'});
  expect(oldSweep()).toEqual(before);
  expect(before).toEqual([79,79,78,77,75]);
  expect(legacy).toEqual(parseCalibration(file));
});
