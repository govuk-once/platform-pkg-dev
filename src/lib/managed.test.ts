import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderExampleFiles, renderManagedFiles } from './managed.js';
import { NODE_MAJOR } from '../versions.js';

const render = (packageDir: string) =>
  renderManagedFiles({ cwd: '/tmp/pkg', packageDir, extend: undefined });

const find = (files: Awaited<ReturnType<typeof render>>, path: string) => {
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new Error(`no managed file at ${path}`);
  return file;
};

describe('renderManagedFiles', () => {
  it('covers every format that has no extends mechanism', async () => {
    const paths = (await render('.')).map((file) => file.path);

    expect(paths).toEqual(
      expect.arrayContaining([
        '.nvmrc',
        '.githooks/pre-commit',
        '.githooks/pre-push',
        '.vscode/settings.json',
        '.vscode/extensions.json',
        '.pre-commit-config.yaml',
        '.oxfmtrc.json',
      ]),
    );
  });

  it('leaves tsconfig and .oxlintrc.json alone, since those extend platform-pkg-dev', async () => {
    const paths = (await render('.')).map((file) => file.path);

    expect(paths).not.toContain('tsconfig.json');
    expect(paths).not.toContain('.oxlintrc.json');
    expect(paths).not.toContain('.gitignore');
    expect(paths).not.toContain('README.md');
  });

  it('takes the Node version from versions.json', async () => {
    expect(find(await render('.'), '.nvmrc').content).toBe(`${NODE_MAJOR}\n`);
  });

  it('makes the hook shims executable', async () => {
    for (const path of ['.githooks/pre-commit', '.githooks/pre-push']) {
      expect(find(await render('.'), path).mode, path).toBe(0o755);
    }
  });

  it('keeps the hook shims thin, delegating to platform-pkg-dev', async () => {
    const hook = find(await render('.'), '.githooks/pre-commit').content;

    expect(hook).toContain('node_modules/platform-pkg-dev/hooks/dev-hook');
    // The logic must live in platform-pkg-dev, not be copied into every package.
    expect(hook).not.toContain('pre-commit hook-impl');
    // Resolve the package root, export it, hand over. Nothing more: the chain
    // itself must not be copied into every package.
    const logic = hook
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'));

    expect(logic.length).toBeLessThanOrEqual(3);
    expect(hook).not.toContain('sync --check');
    expect(hook).not.toContain('command -v pre-commit');
  });

  it('resolves paths from the script, not the working directory', async () => {
    const hook = find(await render('connect-org'), '.githooks/pre-commit').content;

    // git runs hooks from the repository root, but the same script has to work
    // when run by hand from the package root, so nothing may be cwd-relative.
    expect(hook).toContain('dirname "$0"');
    expect(hook).not.toContain('./connect-org/');
  });

  it('is identical whatever the package is called or where it sits', async () => {
    const nested = find(await render('connect-org'), '.githooks/pre-commit').content;
    const root = find(await render('.'), '.githooks/pre-commit').content;

    expect(nested).toBe(root);
  });

  it('renders identically twice, so sync reports no phantom drift', async () => {
    expect(await render('connect-org')).toEqual(await render('connect-org'));
  });
});

describe('renderExampleFiles', () => {
  const context = (cwd: string) => ({ cwd, packageDir: '.', extend: undefined });

  it('offers every example when the package has none of the real files', async () => {
    const paths = (await renderExampleFiles(context('/tmp/definitely-empty-xyz'))).map(
      (file) => file.path,
    );

    expect(paths).toEqual([
      '.claude/settings.local.json.example',
      '.env.example',
      '.githooks/pre-commit.extend.sh.example',
      '.githooks/pre-push.extend.sh.example',
      'pre-commit.extend.yaml.example',
    ]);
  });

  it('drops an example once its real counterpart exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platform-pkg-dev-examples-'));
    await mkdir(join(dir, '.githooks'), { recursive: true });
    await writeFile(join(dir, '.githooks', 'pre-commit.extend.sh'), '#!/bin/sh\n', 'utf8');

    const paths = (await renderExampleFiles(context(dir))).map((file) => file.path);

    // An example sitting next to the thing it was an example of is clutter.
    expect(paths).not.toContain('.githooks/pre-commit.extend.sh.example');
    expect(paths).toContain('.githooks/pre-push.extend.sh.example');
  });

  it('names each example after the file it seeds', async () => {
    for (const file of await renderExampleFiles(context('/tmp/definitely-empty-xyz'))) {
      expect(file.path.endsWith('.example')).toBe(true);
    }
  });
});

describe('workspace members', () => {
  const member = (packageDir: string) =>
    renderManagedFiles({ cwd: '/tmp/pkg', packageDir, extend: undefined, isMember: true });

  it('gets no git hooks, pre-commit config, editor settings or .nvmrc', async () => {
    const paths = (await member('packages/thing')).map((file) => file.path);

    // git resolves core.hooksPath once per repository and pre-commit reads one
    // config, so copies in a member are files that could never run.
    expect(paths).not.toContain('.githooks/pre-commit');
    expect(paths).not.toContain('.githooks/pre-push');
    expect(paths).not.toContain('.pre-commit-config.yaml');
    expect(paths).not.toContain('.vscode/settings.json');
    expect(paths).not.toContain('.nvmrc');
  });

  it('gets no managed files at all - the root governs every one of them', async () => {
    // oxlint and oxfmt walk up for the nearest config and git resolves hooks
    // once per repository, so a member needs none of it.
    expect(await member('packages/thing')).toEqual([]);
  });

  it('gets no lint or format config, since the root config applies', async () => {
    const paths = (await member('packages/thing')).map((file) => file.path);

    expect(paths).not.toContain('.oxlintrc.json');
    expect(paths).not.toContain('.oxfmtrc.json');
  });

  it('offers no root-only examples either', async () => {
    const paths = (
      await renderExampleFiles({
        cwd: '/tmp/definitely-empty-xyz',
        packageDir: 'packages/thing',
        extend: undefined,
        isMember: true,
      })
    ).map((file) => file.path);

    expect(paths).not.toContain('.env.example');
    expect(paths).not.toContain('pre-commit.extend.yaml.example');
    expect(paths).not.toContain('.githooks/pre-commit.extend.sh.example');
  });

  it('gives a standalone package the full set', async () => {
    const standalone = (
      await renderManagedFiles({ cwd: '/tmp/pkg', packageDir: '.', extend: undefined })
    ).map((file) => file.path);

    expect(standalone).toContain('.githooks/pre-commit');
    expect(standalone).toContain('.pre-commit-config.yaml');
  });
});
