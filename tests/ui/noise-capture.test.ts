import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openMic } from '../../src/ui/audio/mic';
import { audioContext, micOpened, releaseNoiseContext } from '../../src/ui/audio/tone';
import { recorderWorklet } from '../../src/ui/audio/recorderWorklet';
import { runInNewContext } from 'node:vm';

vi.mock('../../src/ui/audio/tone', () => ({ audioContext: vi.fn(), micOpened: vi.fn(), releaseNoiseContext: vi.fn() }));
const node = () => ({connect: vi.fn(), disconnect: vi.fn()});
const block = () => new Float32Array(4096).fill(0.5);
function setup() {
  const track = Object.assign(new EventTarget(), {
    stop: vi.fn(), label: 'private', getSettings: () => ({deviceId: 'private', autoGainControl: false}),
  });
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const devices = Object.assign(new EventTarget(), { getUserMedia: vi.fn(async () => stream) });
  vi.stubGlobal('navigator', {mediaDevices: devices});
  const processor = { ...node(), onaudioprocess: null as null | ((event: object) => void) };
  const ctx = Object.assign(new EventTarget(), {
    state: 'running', sampleRate: 44100, createMediaStreamSource: node, createGain: () => ({...node(), gain: {value: 1}}),
    createScriptProcessor: () => processor, destination: {},
  });
  vi.mocked(audioContext).mockReturnValue(ctx as unknown as AudioContext);
  const controller = new AbortController();
  const options = { signal: controller.signal, onBlock: vi.fn((_pcm: Float32Array, _sequence: number) => {}), onInterrupt: vi.fn((_reason: string) => controller.abort()) };
  return {track, stream, devices, processor, ctx, controller, options};
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('общий захват', () => {
  it('создаёт свежий контекст после Stop, сохраняя контекст, занятый другим инструментом', async () => {
    const tone = await vi.importActual<typeof import('../../src/ui/audio/tone')>('../../src/ui/audio/tone');
    class Context {
      state = 'running';
      close = vi.fn(async () => { this.state = 'closed'; });
    }
    vi.stubGlobal('window', { AudioContext: Context });
    const first = tone.audioContext(true);
    tone.releaseNoiseContext(first);
    expect(first.state).toBe('closed');
    const second = tone.audioContext(true);
    expect(second).not.toBe(first);
    expect(tone.audioContext()).toBe(second);
    tone.releaseNoiseContext(second);
    expect(second.state).toBe('running');
  });
  it('при открытой дорожке без PCM завершает ожидание и освобождает вход для нового запуска', async () => {
    vi.useFakeTimers();
    const {ctx, track, options, processor} = setup();
    const first = await openMic(options);
    vi.advanceTimersByTime(6000);
    expect(options.onInterrupt).toHaveBeenCalledWith('noData');
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(releaseNoiseContext).toHaveBeenCalledWith(ctx);
    first.close();
    const next = await openMic({...options, signal: new AbortController().signal});
    processor.onaudioprocess!({playbackTime: 0, inputBuffer: {getChannelData: () => new Float32Array(4096)}});
    vi.advanceTimersByTime(6000);
    expect(options.onBlock).toHaveBeenCalledTimes(1);
    expect(options.onInterrupt).toHaveBeenCalledTimes(1);
    next.close();
  });
  it('одна ограниченная повторная попытка, диагностика, пропуск и прерывание', async () => {
    const {devices, options, track, processor} = setup();
    devices.getUserMedia.mockRejectedValueOnce(new DOMException('', 'OverconstrainedError'));
    const mic = await openMic(options);
    expect(devices.getUserMedia).toHaveBeenLastCalledWith({audio: true});
    expect(mic.diagnostics).toMatchObject({backend:'ScriptProcessor', constraintsFallback:true, sampleRate:44100,
      settings: {autoGainControl:false, noiseSuppression:null, sampleRate:null}});
    expect(JSON.stringify(mic.diagnostics)).not.toContain('private');
    await expect(openMic()).rejects.toMatchObject({name:'InvalidStateError'});
    const pcm = block();
    for (const t of [0, 3 * 4096 / 44100]) processor.onaudioprocess!({playbackTime:t, inputBuffer:{getChannelData: () => pcm}});
    expect(options.onBlock.mock.calls.map(c => c.at(1))).toEqual([0,3]);
    track.dispatchEvent(new Event('ended'));
    expect(options.onInterrupt).toHaveBeenCalledWith('track');
    mic.close();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(processor.onaudioprocess).toBeNull();
    expect(micOpened).toHaveBeenLastCalledWith(false);
  });
  it('отказ не вызывает повторный запрос, следующий запуск доступен', async () => {
    const {devices, options} = setup();
    for (const name of ['NotAllowedError', 'NotReadableError', 'NotFoundError']) {
      devices.getUserMedia.mockRejectedValueOnce(new DOMException('',name));
      await expect(openMic(options)).rejects.toMatchObject({name});
    }
    expect(devices.getUserMedia).toHaveBeenCalledTimes(3);
    expect(micOpened).not.toHaveBeenCalled();
    (await openMic(options)).close();
  });
  it('позднее разрешение не останавливает нового владельца, прежняя запись сохраняет все отсчёты', async () => {
    const {devices, stream, controller, options, processor} = setup();
    let grant!: (s: typeof stream) => void;
    devices.getUserMedia.mockImplementationOnce(() => new Promise(resolve => { grant = resolve; }));
    const first = openMic(options);
    controller.abort();
    const legacy = await openMic();
    const abandoned = Object.assign(new EventTarget(), stream.getTracks()[0], {stop:vi.fn()});
    grant({...stream, getTracks: () => [abandoned]});
    await expect(first).rejects.toMatchObject({name:'AbortError'});
    expect(abandoned.stop).toHaveBeenCalledTimes(1);
    await expect(openMic()).rejects.toMatchObject({name:'InvalidStateError'});
    legacy.start();
    for (const val of [1,2]) processor.onaudioprocess!({inputBuffer:{getChannelData: () => Float32Array.of(val)}});
    expect([...legacy.stop()]).toEqual([1,2]);
    legacy.close();
  });
  it('worklet ограничивает очередь одним пакетом, последовательность отмечает пропуск', () => {
    const post = vi.fn();
    class Base { port = {postMessage: post, onmessage: vi.fn<(_: {data: unknown}) => void>()}; }
    let processor!: Base & { process(inputs: Float32Array[][]): boolean };
    runInNewContext(recorderWorklet, { AudioWorkletProcessor: Base, registerProcessor: (_: string, Ctor: new () => typeof processor) => {processor = new Ctor();} });
    processor.port.onmessage({data: 'stream'});
    const send = () => { for (let i = 0; i < 32; i++) processor.process([[new Float32Array(128)]]); };
    send(); send();
    expect(post).toHaveBeenCalledTimes(1);
    processor.port.onmessage({data:'ack'});
    send();
    expect(post.mock.calls.map(c => c[0].sequence)).toEqual([0,2]);
    expect(post.mock.calls[0][0].pcm.length).toBe(4096);
  });
});

it('удерживает точный deviceId при повторном запросе и освобождает неподтверждённую дорожку', async () => {
  const { devices, options, track } = setup();
  devices.getUserMedia.mockRejectedValueOnce(new DOMException('', 'OverconstrainedError'));
  await expect(openMic({ ...options, deviceId:'different' })).rejects.toMatchObject({name:'OverconstrainedError'});
  expect(devices.getUserMedia).toHaveBeenLastCalledWith({audio:{deviceId:{exact:'different'}}});
  expect(track.stop).toHaveBeenCalledTimes(1);
  const mic = await openMic({...options, deviceId:'private'});
  expect(JSON.stringify(mic.diagnostics)).not.toContain('private');
  mic.close();
});

describe('054 · вход старых инструментов', () => {
  const preferred = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
  it('системный вход открывается прежним запросом; выбранный — точным deviceId; маршрут возвращается для подтверждения', async () => {
    const { devices, track } = setup();
    const legacy = await openMic();
    expect(devices.getUserMedia).toHaveBeenLastCalledWith({ audio: preferred });
    expect(legacy.route).toEqual({ deviceId: 'private', groupId: null, label: 'private', sampleRate: 44100 });
    expect('diagnostics' in legacy && legacy.diagnostics).toBeFalsy();
    await expect(openMic()).rejects.toMatchObject({ name: 'InvalidStateError' });
    legacy.close();
    expect(track.stop).toHaveBeenCalledTimes(1);
    const chosen = await openMic({ deviceId: 'private' });
    expect(devices.getUserMedia).toHaveBeenLastCalledWith({ audio: { ...preferred, deviceId: { exact: 'private' } } });
    chosen.close();
    // другой вход, чем просили, не принимается и не держит микрофон
    await expect(openMic({ deviceId: 'usb' })).rejects.toMatchObject({ name: 'OverconstrainedError' });
    expect(track.stop).toHaveBeenCalledTimes(3);
    (await openMic()).close();
  });
});

describe('057 · окружение и события входа', () => {
  it('журнал событий без идентификаторов; devicechange останавливает захват при любом выборе калибровки', async () => {
    const { devices, options, track, ctx } = setup();
    const mic = await openMic(options);
    expect(mic.diagnostics.environment).toEqual({ displayMode: null, appleStandalone: null });
    track.dispatchEvent(new Event('mute'));
    track.dispatchEvent(new Event('unmute'));
    expect(options.onInterrupt).not.toHaveBeenCalled();
    ctx.state = 'suspended';
    ctx.dispatchEvent(new Event('statechange'));
    devices.dispatchEvent(new Event('devicechange'));
    expect(options.onInterrupt).toHaveBeenCalledWith('device');
    expect(mic.diagnostics.events.map(e => e.type + (e.state ? ':' + e.state : ''))).toEqual(['mute', 'unmute', 'context:suspended', 'devicechange']);
    expect(mic.diagnostics.events.every(e => Number.isInteger(e.atMs) && e.atMs >= 0)).toBe(true);
    expect(JSON.stringify(mic.diagnostics)).not.toContain('private');
    // после закрытия события не пишутся
    mic.close();
    devices.dispatchEvent(new Event('devicechange'));
    expect(mic.diagnostics.events).toHaveLength(4);
  });
  it('установленное приложение: режим отображения и navigator.standalone', async () => {
    const { options, devices } = setup();
    vi.stubGlobal('navigator', { mediaDevices: devices, standalone: true });
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }));
    const mic = await openMic(options);
    expect(mic.diagnostics.environment).toEqual({ displayMode: 'standalone', appleStandalone: true });
    mic.close();
  });
  it('у старых инструментов без потока — прежний вход без журнала и слушателей', async () => {
    const { devices } = setup();
    const add = vi.spyOn(devices, 'addEventListener');
    const legacy = await openMic();
    expect('diagnostics' in legacy && legacy.diagnostics).toBeFalsy();
    expect(add).not.toHaveBeenCalled();
    legacy.close();
  });
});
