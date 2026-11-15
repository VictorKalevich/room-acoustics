// 034: логика запуска расчёта из интерфейса (src/ui/computeTask.ts) — без Preact и воркера: таймеры и задачи фальшивые.
import { describe, expect, it } from 'vitest';
import { ComputeAction, ComputeTask, type ResultCache, type RunJob, type TaskOptions, type TaskState, type Timers } from '../../src/ui/computeTask';
import { inMainThread } from '../../src/ui/compute';
import { defaultRoom } from '../../src/state/project';

/** Ответы и ошибки приходят после микрозадач цепочки `then`/`catch`. */
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function fakeTimers() {
  let now = 0;
  let seq = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => { const id = ++seq; pending.set(id, { at: now + ms, fn }); return id; },
    clear: (id) => { pending.delete(id as number); },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) if (t.at <= now) { pending.delete(id); t.fn(); }
  };
  return { timers, advance, pending };
}

interface FakeJob<I, V> {
  input: I;
  onProgress?: (v: number) => void;
  cancelled: boolean;
  settled: boolean;
  resolve: (v: V) => void;
  reject: (e: Error) => void;
}

/**
 * Задачи как у compute: отменённая не завершается. `leaky` — отменённая всё же отвечает: так проверяется, что ответ
 * не последней задачи отбрасывается и без гарантии compute.
 */
function fakeJobs<I, V>(leaky = false) {
  const jobs: FakeJob<I, V>[] = [];
  const run: RunJob<I, V> = (input, onProgress) => {
    let ok!: (v: V) => void;
    let fail!: (e: Error) => void;
    const promise = new Promise<V>((a, b) => { ok = a; fail = b; });
    const j: FakeJob<I, V> = {
      input, onProgress, cancelled: false, settled: false,
      resolve: (v) => { if (j.cancelled && !leaky) return; j.settled = true; ok(v); },
      reject: (e) => { if (j.cancelled && !leaky) return; j.settled = true; fail(e); },
    };
    jobs.push(j);
    return { promise, cancel: () => { if (!j.settled) j.cancelled = true; } };
  };
  return { run, jobs };
}

function setup<V = string>(leaky = false) {
  const t = fakeTimers();
  const f = fakeJobs<string, V>(leaky);
  const states: TaskState<V, string>[] = [];
  const task = new ComputeTask<string, V>(f.run, (s) => states.push(s), t.timers);
  /** Изменение входов так, как его делает хук: очистка прежнего эффекта, затем новый эффект. */
  const change = (input: string | null, opts: TaskOptions<V>) => { task.leave(); task.change(input, opts); };
  return { ...t, ...f, task, states, change, state: () => task.current };
}

describe('034: запуск по изменению входов — задержка', () => {
  it('задача уходит только после задержки', () => {
    const s = setup();
    s.change('A', { delay: 250, previous: 'keep' });
    expect(s.jobs).toHaveLength(0);
    s.advance(249);
    expect(s.jobs).toHaveLength(0);
    s.advance(1);
    expect(s.jobs.map((j) => j.input)).toEqual(['A']);
  });

  it('новое изменение во время задержки начинает отсчёт заново: уходит одна задача — с последними входами', () => {
    const s = setup();
    s.change('A', { delay: 350, restart: 'start', previous: 'keep' });
    s.advance(200);
    s.change('B', { delay: 350, restart: 'start', previous: 'keep' });
    s.advance(200);
    expect(s.jobs).toHaveLength(0);
    s.advance(150);
    expect(s.jobs.map((j) => j.input)).toEqual(['B']);
  });

  it('без задержки задача уходит сразу из эффекта', () => {
    const s = setup();
    s.change('A', { previous: 'keep' });
    expect(s.jobs.map((j) => j.input)).toEqual(['A']);
    expect(s.state()).toMatchObject({ busy: true, error: null });
  });
});

describe('034: когда снимается прежняя задача', () => {
  it('restart: change — сразу при изменении входов; «считаем» ставится и ошибка снимается тогда же', async () => {
    const s = setup();
    s.change('A', { delay: 250, previous: 'keep' });
    s.advance(250);
    s.jobs[0].reject(new Error('сбой'));
    await flush();
    expect(s.state()).toMatchObject({ busy: false, error: 'сбой' });
    s.change('B', { delay: 250, previous: 'keep' });
    expect(s.state()).toMatchObject({ busy: true, error: null });
    s.advance(250);
    const a = s.jobs[1];
    s.change('C', { delay: 250, previous: 'keep' });
    expect(a.cancelled).toBe(true);
  });

  it('restart: start — до запуска новой прежняя досчитывается, её результат принимается', async () => {
    const s = setup();
    const opts: TaskOptions<string> = { delay: 350, restart: 'start', previous: 'keep' };
    s.change('A', opts);
    s.advance(350);
    expect(s.state().busy).toBe(true);
    s.change('B', opts);
    const a = s.jobs[0];
    expect(a.cancelled).toBe(false);
    a.resolve('карта A');
    await flush();
    expect(s.state()).toMatchObject({ value: 'карта A', input: 'A', busy: false });
    s.advance(350);
    expect(s.jobs.map((j) => j.input)).toEqual(['A', 'B']);
    expect(s.state()).toMatchObject({ value: 'карта A', busy: true, error: null });
  });

  it('restart: start — прежняя, не досчитанная к запуску новой, снимается в момент запуска', () => {
    const s = setup();
    const opts: TaskOptions<string> = { delay: 300, restart: 'start', previous: 'keep' };
    s.change('A', opts);
    s.advance(300);
    s.change('B', opts);
    s.advance(299);
    expect(s.jobs[0].cancelled).toBe(false);
    s.advance(1);
    expect(s.jobs[0].cancelled).toBe(true);
  });
});

describe('034: устаревший результат не показывается', () => {
  it('ответ снятой задачи отбрасывается, даже если она всё же ответила', async () => {
    const s = setup(true);
    s.change('A', { previous: 'keep' });
    s.change('B', { previous: 'keep' });
    s.jobs[0].resolve('A');
    s.jobs[0].reject(new Error('A'));
    await flush();
    expect(s.state()).toMatchObject({ value: null, busy: true, error: null });
    s.jobs[1].resolve('B');
    await flush();
    expect(s.state()).toMatchObject({ value: 'B', input: 'B', busy: false });
  });

  it('при restart: start ответ задачи, которую сменила новая, отбрасывается', async () => {
    const s = setup(true);
    const opts: TaskOptions<string> = { delay: 300, restart: 'start', previous: 'keep' };
    s.change('A', opts);
    s.advance(300);
    s.change('B', opts);
    s.advance(300);
    s.jobs[0].resolve('A');
    await flush();
    expect(s.state().value).toBeNull();
    s.jobs[1].resolve('B');
    await flush();
    expect(s.state().value).toBe('B');
  });

  it('после размонтирования ответ не принимается, задача снимается', async () => {
    const s = setup(true);
    s.change('A', { delay: 300, restart: 'start', previous: 'keep' });
    s.advance(300);
    const before = s.states.length;
    s.task.dispose();
    expect(s.jobs[0].cancelled).toBe(true);
    s.jobs[0].resolve('A');
    await flush();
    expect(s.states).toHaveLength(before);
  });

  it('размонтирование во время задержки задачу не отправляет', () => {
    const s = setup();
    s.change('A', { delay: 120, previous: 'clear' });
    s.task.dispose();
    s.advance(500);
    expect(s.jobs).toHaveLength(0);
  });
});

describe('034: манера показа', () => {
  it('previous: keep — прежний результат остаётся, пока считается новый', async () => {
    const s = setup();
    s.change('A', { previous: 'keep' });
    s.jobs[0].resolve('A');
    await flush();
    s.change('B', { previous: 'keep' });
    expect(s.state()).toMatchObject({ value: 'A', input: 'A', busy: true });
  });

  it('previous: clear — прежний результат скрывается при изменении входов', async () => {
    const s = setup();
    s.change('A', { delay: 120, previous: 'clear' });
    s.advance(120);
    s.jobs[0].resolve('A');
    await flush();
    s.change('B', { delay: 120, previous: 'clear' });
    expect(s.state()).toMatchObject({ value: null, input: null, busy: true });
  });

  it('входы, по которым посчитан результат, приходят вместе с ним', async () => {
    const s = setup();
    s.change('A', { previous: 'keep' });
    s.jobs[0].resolve('карта');
    await flush();
    expect(s.state()).toMatchObject({ value: 'карта', input: 'A' });
  });
});

describe('034: считать нечего', () => {
  it('restart: change — задача снимается, «считаем», ошибка и результат сброшены', () => {
    const s = setup();
    s.change('A', { delay: 250, previous: 'keep' });
    s.advance(250);
    s.change(null, { delay: 250, previous: 'keep' });
    expect(s.jobs[0].cancelled).toBe(true);
    expect(s.state()).toMatchObject({ value: null, input: null, busy: false, error: null });
  });

  it('restart: start — результат убран, начатая задача досчитывается и показывает результат', async () => {
    const s = setup();
    const opts: TaskOptions<string> = { delay: 300, restart: 'start', previous: 'keep' };
    s.change('A', opts);
    s.advance(300);
    s.change(null, opts);
    expect(s.jobs[0].cancelled).toBe(false);
    expect(s.state()).toMatchObject({ value: null, busy: true });
    s.jobs[0].resolve('A');
    await flush();
    expect(s.state()).toMatchObject({ value: 'A', busy: false });
  });

  it('кэш не спрашивается, если считать нечего', () => {
    const s = setup();
    let asked = 0;
    s.change(null, { previous: 'keep', cache: () => { asked++; return undefined; } });
    expect(asked).toBe(0);
  });
});

describe('034: кэш, ход, ошибка', () => {
  const memo = (m: Map<string, string>, key: string): ResultCache<string> => ({ get: () => m.get(key), set: (v) => { m.set(key, v); } });

  it('попадание в кэш показывается сразу, без задачи; посчитанное попадает в кэш', async () => {
    const s = setup();
    const m = new Map<string, string>();
    s.change('A', { delay: 300, restart: 'start', previous: 'keep', cache: () => memo(m, 'A') });
    s.advance(300);
    s.jobs[0].resolve('поле A');
    await flush();
    expect(m.get('A')).toBe('поле A');
    s.change('B', { delay: 300, restart: 'start', previous: 'keep', cache: () => memo(m, 'B') });
    s.advance(300);
    s.change('A', { delay: 300, restart: 'start', previous: 'keep', cache: () => memo(m, 'A') });
    expect(s.jobs[1].cancelled).toBe(true);
    expect(s.state()).toMatchObject({ value: 'поле A', input: 'A', busy: false, error: null });
    s.advance(1000);
    expect(s.jobs).toHaveLength(2);
  });

  it('ход: reset — с 0 при каждом запуске, carry — с прежнего значения; без хода он не передаётся', async () => {
    const r = setup();
    r.change('A', { previous: 'keep', progress: 'reset' });
    r.jobs[0].onProgress!(0.7);
    expect(r.state().progress).toBe(0.7);
    r.jobs[0].resolve('A');
    await flush();
    r.change('B', { previous: 'keep', progress: 'reset' });
    expect(r.state().progress).toBe(0);

    const c = setup();
    c.change('A', { previous: 'keep', progress: 'carry' });
    c.jobs[0].onProgress!(1);
    c.jobs[0].resolve('A');
    await flush();
    c.change('B', { previous: 'keep', progress: 'carry' });
    expect(c.state().progress).toBe(1);

    const n = setup();
    n.change('A', { previous: 'keep' });
    expect(n.jobs[0].onProgress).toBeUndefined();
  });

  it('ошибка: сообщение, прежний результат остаётся; с fallback — значение вместо ошибки', async () => {
    const s = setup();
    s.change('A', { previous: 'keep' });
    s.jobs[0].resolve('A');
    await flush();
    s.change('B', { previous: 'keep' });
    s.jobs[1].reject(new Error('сбой воркера'));
    await flush();
    expect(s.state()).toMatchObject({ value: 'A', busy: false, error: 'сбой воркера' });

    const f = setup<string[]>();
    f.change('A', { previous: 'clear', fallback: () => [] });
    f.jobs[0].reject(new Error('сбой'));
    await flush();
    expect(f.state()).toMatchObject({ value: [], input: 'A', busy: false, error: null });
  });

  it('состояние отдаётся экрану, только когда изменилось', async () => {
    const s = setup();
    s.change('A', { previous: 'keep' });
    const n = s.states.length;
    s.change('B', { previous: 'keep' });
    expect(s.states).toHaveLength(n);
    s.jobs[1].resolve('B');
    await flush();
    expect(s.states).toHaveLength(n + 1);
  });
});

describe('034: запуск по кнопке', () => {
  function action(opts: { progress?: boolean; cancelOnDispose?: boolean } = {}, leaky = false) {
    const f = fakeJobs<string, string>(leaky);
    const states: { busy: boolean; progress: number }[] = [];
    const a = new ComputeAction((s) => states.push(s), opts);
    const done: string[] = [];
    const failed: string[] = [];
    const run = (input: string, local?: () => string) => a.run(f.run, input, { done: (v) => done.push(v), failed: (e) => failed.push(e.message), local });
    return { ...f, a, states, done, failed, run };
  }

  it('«считаем» на время расчёта, результат и ошибка — экрану', async () => {
    const s = action();
    s.run('A');
    expect(s.a.current.busy).toBe(true);
    s.jobs[0].resolve('результат');
    await flush();
    expect(s.a.current.busy).toBe(false);
    expect(s.done).toEqual(['результат']);
    s.run('B');
    s.jobs[1].reject(new Error('сбой'));
    await flush();
    expect(s.a.current.busy).toBe(false);
    expect(s.failed).toEqual(['сбой']);
  });

  it('ход с 0 при каждом запуске', async () => {
    const s = action({ progress: true });
    s.run('A');
    s.jobs[0].onProgress!(0.5);
    expect(s.a.current.progress).toBe(0.5);
    s.jobs[0].resolve('A');
    await flush();
    s.run('B');
    expect(s.a.current.progress).toBe(0);
  });

  it('основной поток: результат сразу, без задачи и без «считаем»', () => {
    const s = action();
    s.run('A', () => 'сразу');
    expect(s.done).toEqual(['сразу']);
    expect(s.jobs).toHaveLength(0);
    expect(s.states).toHaveLength(0);
  });

  it('повторный запуск снимает прежнюю задачу; при размонтировании — только по выбору экрана', () => {
    const s = action({ cancelOnDispose: true });
    s.run('A');
    s.run('B');
    expect(s.jobs[0].cancelled).toBe(true);
    s.a.dispose();
    expect(s.jobs[1].cancelled).toBe(true);

    const k = action();
    k.run('A');
    k.a.dispose();
    expect(k.jobs[0].cancelled).toBe(false);
  });
});

describe('034: где считать', () => {
  it('прямоугольная модель — в основном потоке, волновая — в воркере', () => {
    const room = defaultRoom();
    expect(inMainThread(room)).toBe(true);
    expect(inMainThread({ ...room, model: 'wave' })).toBe(false);
    expect(inMainThread({ ...room, slope: { wall: 'front', low: 1.2, run: 1 } })).toBe(false);
    expect(inMainThread({ ...room, model: 'modal', slope: { wall: 'front', low: 1.2, run: 1 } })).toBe(true);
  });
});
