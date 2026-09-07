import { mkdir, mkdtemp, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocument } from 'yaml';
import { describe, expect, it } from 'vitest';
import {
  applyWorkspaceSettings,
  renderWorkspaceFile,
  workspaceRootFor,
  WORKSPACE_FILE,
} from './workspace.js';
import { WORKSPACE_SETTINGS } from '../versions.js';

const parse = (yaml: string) => parseDocument(yaml).toJSON() as Record<string, unknown>;

describe('applyWorkspaceSettings', () => {
  it('adds every setting platform-pkg-dev owns', () => {
    const { content, drift } = applyWorkspaceSettings("packages:\n  - 'packages/*'\n");
    const parsed = parse(content);

    for (const [key, value] of Object.entries(WORKSPACE_SETTINGS)) {
      expect(parsed[key], key).toBe(value);
    }
    expect(drift).toHaveLength(Object.keys(WORKSPACE_SETTINGS).length);
  });

  it('never touches the package globs', () => {
    const { content } = applyWorkspaceSettings("packages:\n  - 'apps/*'\n  - 'libs/*'\n");

    // The globs are the package's own; overwriting them to enforce a few
    // security settings would be a poor trade.
    expect(parse(content)['packages']).toEqual(['apps/*', 'libs/*']);
  });

  it('keeps comments and unrelated keys', () => {
    const source = "# my comment\npackages:\n  - 'packages/*'\nsomethingElse: keep me\n";
    const { content } = applyWorkspaceSettings(source);

    expect(content).toContain('# my comment');
    expect(parse(content)['somethingElse']).toBe('keep me');
  });

  it('reports nothing on a file that is already correct', () => {
    const first = applyWorkspaceSettings("packages:\n  - 'packages/*'\n");
    const second = applyWorkspaceSettings(first.content);

    expect(second.drift).toEqual([]);
    expect(second.content).toBe(first.content);
  });

  it('reports the previous value when a setting has been changed', () => {
    const { drift } = applyWorkspaceSettings('minimumReleaseAge: 0\n');
    const change = drift.find((entry) => entry.key === 'minimumReleaseAge');

    expect(change?.from).toBe('0');
    expect(change?.to).toBe(String(WORKSPACE_SETTINGS['minimumReleaseAge']));
  });

  it('pins a release age of a week, in the minutes pnpm expects', () => {
    // pnpm reads minimumReleaseAge in minutes, so a value that looks like days
    // would silently be a seven-minute window.
    expect(WORKSPACE_SETTINGS['minimumReleaseAge']).toBe(7 * 24 * 60);
  });
});

describe('renderWorkspaceFile', () => {
  it('produces a file that is already in sync', () => {
    expect(applyWorkspaceSettings(renderWorkspaceFile()).drift).toEqual([]);
  });

  it('defaults to a packages/* glob and says the settings are managed', () => {
    const content = renderWorkspaceFile();

    expect(parse(content)['packages']).toEqual(['packages/*']);
    expect(content).toContain('dev sync');
  });

  it('accepts custom globs', () => {
    expect(parse(renderWorkspaceFile(['apps/*']))['packages']).toEqual(['apps/*']);
  });

  it('is the filename pnpm reads settings from', () => {
    expect(WORKSPACE_FILE).toBe('pnpm-workspace.yaml');
  });
});

describe('workspaceRootFor', () => {
  const scratch = async (): Promise<string> =>
    await mkdtemp(join(tmpdir(), 'platform-pkg-dev-ws-'));

  it('finds the root when the package sits under a matching glob', async () => {
    const root = await scratch();
    await writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n", 'utf8');
    const member = join(root, 'packages', 'thing');
    await mkdir(member, { recursive: true });

    expect(await realpath((await workspaceRootFor(member)) ?? '')).toBe(await realpath(root));
  });

  it('returns nothing when no glob covers the package', async () => {
    const root = await scratch();
    await writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n", 'utf8');
    const outside = join(root, 'elsewhere', 'thing');
    await mkdir(outside, { recursive: true });

    // A directory that is simply below a workspace root is not a member of it.
    expect(await workspaceRootFor(outside)).toBeUndefined();
  });

  it('returns nothing when there is no workspace above at all', async () => {
    const lonely = join(await scratch(), 'a', 'b');
    await mkdir(lonely, { recursive: true });

    expect(await workspaceRootFor(lonely)).toBeUndefined();
  });

  it('matches a ** glob at any depth beneath it', async () => {
    const root = await scratch();
    await writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/**'\n", 'utf8');
    const deep = join(root, 'packages', 'group', 'thing');
    await mkdir(deep, { recursive: true });

    expect(await realpath((await workspaceRootFor(deep)) ?? '')).toBe(await realpath(root));
  });

  it('does not treat the root itself as a member', async () => {
    const root = await scratch();
    await writeFile(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n", 'utf8');

    expect(await workspaceRootFor(root)).toBeUndefined();
  });
});
