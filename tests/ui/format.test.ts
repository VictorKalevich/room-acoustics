import { describe, expect, it } from 'vitest';
import { fmtSigned, noiseFileName } from '../../src/ui/format';

describe('fmtSigned', () => {
  it('знак — по округлённому значению: малое отрицательное — «0,0», а не «−0,0» (046)', () => {
    expect(fmtSigned(-0.04)).toBe('0,0');
    expect(fmtSigned(0.04)).toBe('0,0');
    expect(fmtSigned(-0)).toBe('0,0');
    expect(fmtSigned(-0.06)).toBe('−0,1');
    expect(fmtSigned(0.06)).toBe('+0,1');
    expect(fmtSigned(-12.34)).toBe('−12,3');
    expect(fmtSigned(-0.4, 0)).toBe('0');
    expect(fmtSigned(2.6, 0)).toBe('+3');
  });
});

describe('noiseFileName (054, UX-001)', () => {
  const start = new Date(2026, 10, 22, 9, 5).getTime();
  it('название пользователя без префикса и без двойного расширения, безопасные символы', () => {
    expect(noiseFileName('Ступени 1 кГц', start)).toBe('Ступени 1 кГц.json');
    expect(noiseFileName('  кухня.json ', start)).toBe('кухня.json');
    expect(noiseFileName('a/b:c*?', start)).toBe('a-b-c.json');
    expect(noiseFileName('..скрытый', start)).toBe('скрытый.json');
    expect(noiseFileName('x'.repeat(200), start)).toBe('x'.repeat(80) + '.json');
  });
  it('без названия — информативное имя по началу записи', () => {
    expect(noiseFileName('', start)).toBe('noise-2026-11-22-0905.json');
    expect(noiseFileName('///', start)).toBe('noise-2026-11-22-0905.json');
    expect(noiseFileName('', null, start)).toBe('noise-2026-11-22-0905.json');
  });
});
