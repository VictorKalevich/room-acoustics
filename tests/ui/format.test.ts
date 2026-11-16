import { describe, expect, it } from 'vitest';
import { fmtSigned } from '../../src/ui/format';

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
