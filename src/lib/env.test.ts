import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { flagEnabled, readDotenv } from './env.js';

const scratch = async (contents?: string): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'platform-pkg-dev-env-'));
  if (contents !== undefined) await writeFile(join(dir, '.env'), contents, 'utf8');
  return dir;
};

afterEach(() => {
  delete process.env['SOME_FLAG'];
});

describe('readDotenv', () => {
  it('is empty when there is no .env, rather than throwing', async () => {
    expect(readDotenv(await scratch())).toEqual({});
  });

  it('skips comments and blank lines', async () => {
    const dir = await scratch('# a comment\n\nA=1\n');
    expect(readDotenv(dir)).toEqual({ A: '1' });
  });

  it('handles quotes, export prefixes and spacing', async () => {
    const dir = await scratch('export A = "one"\nB=\'two\'\nC = three\n');
    expect(readDotenv(dir)).toEqual({ A: 'one', B: 'two', C: 'three' });
  });

  it('strips a trailing comment from an unquoted value', async () => {
    const dir = await scratch('A=1 # why\n');
    expect(readDotenv(dir)['A']).toBe('1');
  });

  it('keeps a # that is part of a quoted value', async () => {
    const dir = await scratch('A="1 # two"\n');
    expect(readDotenv(dir)['A']).toBe('1 # two');
  });
});

describe('flagEnabled', () => {
  it('is false when the flag is absent', async () => {
    expect(flagEnabled('SOME_FLAG', await scratch())).toBe(false);
  });

  it('treats the usual off values as off', async () => {
    for (const value of ['0', 'false', 'no', 'off', '']) {
      const dir = await scratch(`SOME_FLAG=${value}\n`);
      expect(flagEnabled('SOME_FLAG', dir), value).toBe(false);
    }
  });

  it('treats anything else as on', async () => {
    for (const value of ['1', 'true', 'yes', 'anything']) {
      const dir = await scratch(`SOME_FLAG=${value}\n`);
      expect(flagEnabled('SOME_FLAG', dir), value).toBe(true);
    }
  });

  it('lets the real environment override the file', async () => {
    const dir = await scratch('SOME_FLAG=true\n');
    process.env['SOME_FLAG'] = '0';

    // So a one-off `SOME_FLAG=0 dev sync` works without editing .env.
    expect(flagEnabled('SOME_FLAG', dir)).toBe(false);
  });
});
