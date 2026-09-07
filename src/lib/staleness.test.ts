import { mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBuildStale, pkgDevRoot } from './staleness.js';

async function checkout(srcAt: number, distAt?: number): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'platform-pkg-dev-stale-'));
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  await utimes(join(dir, 'src', 'a.ts'), srcAt, srcAt);

  if (distAt !== undefined) {
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'a.js'), 'export const a = 1;\n', 'utf8');
    await utimes(join(dir, 'dist', 'a.js'), distAt, distAt);
  }

  return dir;
}

describe('isBuildStale', () => {
  it('is true when a source file is newer than the build', async () => {
    expect(isBuildStale(await checkout(2000, 1000))).toBe(true);
  });

  it('is false when the build is newer', async () => {
    expect(isBuildStale(await checkout(1000, 2000))).toBe(false);
  });

  it('is true when there is no build at all', async () => {
    expect(isBuildStale(await checkout(1000))).toBe(true);
  });

  it('is false for an installed copy, which ships dist and no src', async () => {
    // `files` excludes src, so the absence of src means this is not a checkout
    // and there is nothing that could be uncompiled.
    const dir = await mkdtemp(join(tmpdir(), 'platform-pkg-dev-installed-'));
    await mkdir(join(dir, 'dist'), { recursive: true });
    await writeFile(join(dir, 'dist', 'a.js'), '', 'utf8');

    expect(isBuildStale(dir)).toBe(false);
  });
});

describe('pkgDevRoot', () => {
  it('resolves the package root, not dist', () => {
    // Off by one here silently disables the staleness check entirely.
    expect(pkgDevRoot()).not.toMatch(/dist\/?$/);
    expect(pkgDevRoot()).toMatch(/platform-pkg-dev\/?$/);
  });
});
