import { describe, expect, it } from 'vitest';
import { isCI } from './ci.js';

describe('isCI', () => {
  it.each([['true'], ['1'], ['yes']])('treats CI=%s as a pipeline', (value) => {
    expect(isCI({ CI: value })).toBe(true);
  });

  it.each([[undefined], [''], ['false'], ['0']])('treats CI=%s as a developer machine', (value) => {
    expect(isCI(value === undefined ? {} : { CI: value })).toBe(false);
  });
});
