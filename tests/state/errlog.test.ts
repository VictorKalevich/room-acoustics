import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildReport, clearErrors, ERRLOG_KEY, ERRLOG_MAX, installErrorLog, logError, readErrors, reportFileName } from '../../src/state/errlog';

class MemStorage {
  m = new Map<string, string>();
  failNext = 0;
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) {
    if (this.failNext > 0) { this.failNext--; throw new Error('QuotaExceededError'); }
    this.m.set(k, v);
  }
  removeItem(k: string) { this.m.delete(k); }
}
let mem: MemStorage;
beforeEach(() => {
  mem = new MemStorage();
  vi.stubGlobal('localStorage', mem);
});

describe('журнал ошибок', () => {
  it('пишет ошибку с текстом, стеком и контекстом', () => {
    logError('worker', new TypeError('x is undefined'), 'optimize');
    const [e] = readErrors();
    expect(e.kind).toBe('worker');
    expect(e.msg).toBe('TypeError: x is undefined');
    expect(e.stack).toContain('TypeError');
    expect(e.ctx).toBe('optimize');
    expect(Number.isNaN(Date.parse(e.t))).toBe(false);
  });

  it('кольцевой буфер: хранит только последние записи', () => {
    for (let i = 0; i < ERRLOG_MAX + 15; i++) logError('error', `сбой ${i}`);
    const list = readErrors();
    expect(list.length).toBe(ERRLOG_MAX);
    expect(list[list.length - 1].msg).toBe(`сбой ${ERRLOG_MAX + 14}`);
    expect(list[0].msg).toBe('сбой 15');
  });

  it('одинаковые подряд не плодят записи', () => {
    for (let i = 0; i < 5; i++) logError('worker', 'нет памяти', 'field');
    logError('worker', 'нет памяти', 'modes');
    expect(readErrors().length).toBe(2);
  });

  it('испорченная запись в хранилище не ломает чтение', () => {
    mem.setItem(ERRLOG_KEY, '{не json');
    expect(readErrors()).toEqual([]);
    logError('error', 'после порчи');
    expect(readErrors().map((e) => e.msg)).toEqual(['после порчи']);
  });

  it('хранилище переполнено — остаются последние несколько', () => {
    for (let i = 0; i < 20; i++) logError('error', `e${i}`);
    mem.failNext = 1;
    logError('error', 'последняя');
    const list = readErrors();
    expect(list.length).toBe(5);
    expect(list[4].msg).toBe('последняя');
  });

  it('длинные тексты обрезаются', () => {
    logError('error', 'я'.repeat(5000));
    expect(readErrors()[0].msg.length).toBe(500);
  });

  it('очистка', () => {
    logError('error', 'a');
    clearErrors();
    expect(readErrors()).toEqual([]);
  });

  it('без хранилища (приватный режим) — молча ничего не делает', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => logError('error', 'x')).not.toThrow();
    expect(readErrors()).toEqual([]);
  });

  it('ловит необработанные ошибки и отказы промисов, отмену пользователем пропускает', () => {
    const w = new EventTarget() as unknown as Window;
    installErrorLog(w);
    const err = Object.assign(new Event('error'), { error: new RangeError('Invalid array length'), message: 'Invalid array length', filename: 'https://x/assets/index-abc.js', lineno: 10, colno: 5 });
    w.dispatchEvent(err);
    w.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('промис') }));
    w.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: Object.assign(new Error('отмена'), { name: 'AbortError' }) }));
    const list = readErrors();
    expect(list.map((e) => e.kind)).toEqual(['error', 'rejection']);
    expect(list[0].msg).toBe('RangeError: Invalid array length');
    expect(list[0].ctx).toBe('index-abc.js:10:5');
  });
});

describe('отчёт о проблеме', () => {
  const device = { userAgent: 'iPhone', language: 'ru', screen: '402×874', viewport: '402×780', dpr: 3, standalone: true, online: true };
  it('собирает версию, устройство, ошибки; проект — только по желанию', () => {
    logError('scan', 'Неизвестный формат', 'scan.txt');
    const r = buildReport({ build: { time: '2026-11-08T10:00:00Z', sha: 'abc1234' }, device, errors: readErrors(), note: '  гудит  ' });
    expect(r.kind).toBe('room-acoustics-report');
    expect(r.app.sha).toBe('abc1234');
    expect(r.errors.length).toBe(1);
    expect(r.note).toBe('гудит');
    expect('project' in r).toBe(false);
    const withP = buildReport({ build: { time: '', sha: '' }, device, errors: [], project: { a: 1 } });
    expect(withP.project).toEqual({ a: 1 });
    expect('note' in withP).toBe(false);
  });

  it('имя файла', () => {
    expect(reportFileName(new Date(2026, 10, 8, 7, 5))).toBe('room-acoustics-report-2026-11-08-0705.json');
  });
});
