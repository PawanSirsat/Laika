import { describe, expect, it } from 'vitest';
import { deviceLabelKey } from '../../src/db/device-label.ts';

describe('deviceLabelKey (LAI-590)', () => {
  it('trims and case-folds beyond ASCII, as SQLite lower() does not', () => {
    expect(deviceLabelKey('  BÉLKA\t')).toBe('bélka');
    expect(deviceLabelKey('Strelka')).toBe('strelka');
  });

  it('gives null and blank labels the one empty key', () => {
    expect(deviceLabelKey(null)).toBe('');
    expect(deviceLabelKey('')).toBe('');
    expect(deviceLabelKey(' \t ')).toBe('');
  });
});
