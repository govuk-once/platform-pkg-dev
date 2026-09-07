import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findProjectRoot } from './project.js';

describe('findProjectRoot', () => {
  it('walks up from a nested directory to the nearest package.json', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'platform-pkg-dev-root-')));
    await writeFile(join(root, 'package.json'), '{}', 'utf8');

    const nested = join(root, 'src', 'lib', 'deep');
    await mkdir(nested, { recursive: true });

    expect(await realpath(findProjectRoot(nested))).toBe(root);
  });

  it('stops at the closest package.json, not the outermost', async () => {
    const outer = await realpath(await mkdtemp(join(tmpdir(), 'platform-pkg-dev-root-')));
    await writeFile(join(outer, 'package.json'), '{}', 'utf8');

    const inner = join(outer, 'packages', 'inner');
    await mkdir(inner, { recursive: true });
    await writeFile(join(inner, 'package.json'), '{}', 'utf8');

    expect(await realpath(findProjectRoot(join(inner, 'src')))).toBe(inner);
  });
});
