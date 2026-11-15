// 034: логика запуска расчёта из интерфейса — без Preact, воркера и системных таймеров (их передают хуки useCompute.ts,
// тесты — фальшивые). Одна цепочка вместо копий в экранах: задержка, снятие прежней задачи, устаревший ответ, «считаем»,
// ошибка, кэш и ход. Отмена снимает только задачу, которая ещё не началась (см. compute.ts): начатая досчитывается,
// а её ответ отбрасывается; обещание отменённой задачи не завершается.

/** Запущенная задача: как ComputeJob из compute.ts. */
export interface TaskJob<V> {
  promise: Promise<V>;
  cancel: () => void;
}

/** Запуск задачи по входным данным; `onProgress` передаётся, только если ход нужен экрану. */
export type RunJob<I, V> = (input: I, onProgress?: (v: number) => void) => TaskJob<V>;

/** Таймер задержки запуска. */
export interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
}

export const systemTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Кэш результата для одних входных данных: экран строит его в момент изменения входов. */
export interface ResultCache<V> {
  get: () => V | undefined;
  set: (v: V) => void;
}

export interface TaskOptions<V> {
  /** Задержка запуска, мс: пока входы меняются, задача не уходит. Без задержки — сразу. */
  delay?: number;
  /**
   * Когда снимается прежняя задача. `change` — сразу при изменении входов; тогда же ставится «считаем» и снимается
   * ошибка. `start` — только при запуске новой: до него прежняя досчитывается, её результат принимается.
   */
  restart?: 'change' | 'start';
  /** Прежний результат, пока считается новый: остаётся (`keep`) или скрывается (`clear`). */
  previous: 'keep' | 'clear';
  /** Ход расчёта: с 0 при каждом запуске (`reset`) или с прежнего значения (`carry`). Без него ход не ведётся. */
  progress?: 'reset' | 'carry';
  /** Значение результата при ошибке; без него ошибка — сообщение `error`. */
  fallback?: (e: Error) => V;
  /** Кэш для этих входов: попадание показывается сразу, без задачи. Вызывается, только если считать есть что. */
  cache?: () => ResultCache<V> | undefined;
}

export interface TaskState<V, I> {
  /** Последний принятый результат. */
  value: V | null;
  /** Входные данные, по которым он посчитан. */
  input: I | null;
  busy: boolean;
  error: string | null;
  progress: number;
}

export const idleState = <V, I>(): TaskState<V, I> => ({ value: null, input: null, busy: false, error: null, progress: 0 });

const same = <V, I>(a: TaskState<V, I>, b: TaskState<V, I>) =>
  a.value === b.value && a.input === b.input && a.busy === b.busy && a.error === b.error && a.progress === b.progress;

/**
 * Запуск по изменению входных данных. Хук вызывает `change` из эффекта, `leave` — из его очистки, `dispose` — при
 * размонтировании; `emit` получает новое состояние, только когда оно изменилось.
 */
export class ComputeTask<I, V> {
  private state: TaskState<V, I> = idleState();
  private job: TaskJob<V> | null = null;
  private timer: unknown = null;
  private opts: TaskOptions<V> = { previous: 'keep' };

  constructor(
    private readonly run: RunJob<I, V>,
    private readonly emit: (s: TaskState<V, I>) => void,
    private readonly timers: Timers = systemTimers,
  ) {}

  get current(): TaskState<V, I> { return this.state; }

  /** Входы изменились; `input` null — считать нечего. */
  change(input: I | null, opts: TaskOptions<V>): void {
    this.opts = opts;
    const restartNow = (opts.restart ?? 'change') === 'change';
    if (input === null) {
      // при `start` начатая задача не снимается и, досчитав, покажет результат (так было в «Поле 3D»)
      this.set(restartNow ? { value: null, input: null, busy: false, error: null } : { value: null, input: null });
      return;
    }
    const cache = opts.cache?.();
    const hit = cache?.get();
    if (hit !== undefined) {
      this.drop();
      this.set({ value: hit, input, busy: false, error: null });
      return;
    }
    if (opts.previous === 'clear') this.set({ value: null, input: null });
    if (restartNow) this.set({ busy: true, error: null });
    if (opts.delay) {
      this.timer = this.timers.set(() => { this.timer = null; this.start(input, cache); }, opts.delay);
    } else this.start(input, cache);
  }

  /** Очистка эффекта: перед следующим изменением входов и при размонтировании. */
  leave(): void {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    if ((this.opts.restart ?? 'change') === 'change') this.drop();
  }

  /** Экран размонтирован. */
  dispose(): void {
    this.leave();
    this.drop();
  }

  private drop() {
    this.job?.cancel();
    this.job = null;
  }

  private start(input: I, cache: ResultCache<V> | undefined) {
    this.drop();
    const { progress, fallback } = this.opts;
    this.set(progress === 'reset' ? { busy: true, error: null, progress: 0 } : { busy: true, error: null });
    let j: TaskJob<V> | null = null;
    const onProgress = progress ? (v: number) => { if (this.job === j) this.set({ progress: v }); } : undefined;
    j = this.run(input, onProgress);
    const job = j;
    this.job = job;
    job.promise
      .then((v) => {
        if (this.job !== job) return;
        this.job = null;
        cache?.set(v);
        this.set({ value: v, input, busy: false });
      })
      .catch((e: Error) => {
        if (this.job !== job) return;
        this.job = null;
        this.set(fallback ? { value: fallback(e), input, busy: false } : { error: e.message, busy: false });
      });
  }

  private set(patch: Partial<TaskState<V, I>>) {
    const next = { ...this.state, ...patch };
    if (same(next, this.state)) return;
    this.state = next;
    this.emit(next);
  }
}

export interface ActionState {
  busy: boolean;
  progress: number;
}

export interface ActionHandlers<V> {
  done: (v: V) => void;
  failed: (e: Error) => void;
  /** Тот же расчёт в основном потоке: если задан, результат приходит сразу, без задачи и без «считаем». */
  local?: () => V;
}

/**
 * Запуск по кнопке. Что делать с результатом и ошибкой, решает экран (`done`, `failed`); здесь — «считаем», ход с 0 и
 * снятие прежней задачи при повторном запуске, а по выбору экрана — и при размонтировании.
 */
export class ComputeAction {
  private state: ActionState = { busy: false, progress: 0 };
  private job: TaskJob<unknown> | null = null;

  constructor(
    private readonly emit: (s: ActionState) => void,
    private readonly opts: { progress?: boolean; cancelOnDispose?: boolean } = {},
  ) {}

  get current(): ActionState { return this.state; }

  run<I, V>(start: RunJob<I, V>, input: I, h: ActionHandlers<V>): void {
    if (h.local) { h.done(h.local()); return; }
    this.set(this.opts.progress ? { busy: true, progress: 0 } : { busy: true });
    this.job?.cancel();
    let j: TaskJob<V> | null = null;
    const onProgress = this.opts.progress ? (v: number) => { if (this.job === j) this.set({ progress: v }); } : undefined;
    j = start(input, onProgress);
    this.job = j;
    j.promise
      .then((v) => { this.set({ busy: false }); h.done(v); })
      .catch((e: Error) => { this.set({ busy: false }); h.failed(e); });
  }

  dispose(): void {
    if (this.opts.cancelOnDispose) this.job?.cancel();
  }

  private set(patch: Partial<ActionState>) {
    const next = { ...this.state, ...patch };
    if (next.busy === this.state.busy && next.progress === this.state.progress) return;
    this.state = next;
    this.emit(next);
  }
}
