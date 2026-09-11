import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isSeedFile, renderTemplateDir, substitute, targetName, TEMPLATES_ROOT } from './render.js';

describe('substitute', () => {
  it('replaces every occurrence', () => {
    expect(substitute('{{a}}-{{b}}-{{a}}', { a: 'x', b: 'y' })).toBe('x-y-x');
  });

  it('throws on an unknown placeholder rather than rendering it literally', () => {
    expect(() => substitute('{{nope}}', {})).toThrow(/unknown variable "nope"/);
  });
});

describe('targetName', () => {
  it('restores dotfiles from their underscore-prefixed template names', () => {
    expect(targetName('_gitignore')).toBe('.gitignore');
    expect(targetName('_oxlintrc.json')).toBe('.oxlintrc.json');
    expect(targetName('tsconfig.json')).toBe('tsconfig.json');
  });
});

const VARS = {
  packageName: 'connect-org',
  team: 'identity',
  cdkNote: '',
  cdkSection: '',
};

async function scratch(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'platform-pkg-dev-render-'));
}

describe('renderTemplateDir', () => {
  it('renders the base template with dotfiles restored', async () => {
    const dir = await scratch();
    const report = await renderTemplateDir('base', dir, VARS, { force: false });

    // .nvmrc, .githooks and .vscode are managed by platform-pkg-dev, not seeded here.
    expect(report.written).toContain('.gitignore');
    expect(report.written).toContain('.oxlintrc.json');
    expect(report.written).toContain('tsconfig.json');

    expect(await readFile(join(dir, 'README.md'), 'utf8')).toContain('identity');
  });

  it('leaves existing files alone unless forced', async () => {
    const dir = await scratch();
    await writeFile(join(dir, '.gitignore'), 'mine\n', 'utf8');

    const first = await renderTemplateDir('base', dir, VARS, { force: false });
    expect(first.skipped).toContain('.gitignore');
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('mine\n');

    const second = await renderTemplateDir('base', dir, VARS, { force: true });

    // Seed files are skipped even when forced - see isSeedFile.
    expect(second.skipped.every(isSeedFile)).toBe(true);
    expect(second.skipped).not.toContain('.gitignore');
  });

  it('renders nested template directories', async () => {
    const dir = await scratch();
    await mkdir(dir, { recursive: true });
    const report = await renderTemplateDir('base', dir, VARS, { force: false });

    expect(report.written).toContain(join('src', 'index.ts'));
    expect(await readFile(join(dir, 'src', 'index.ts'), 'utf8')).toContain("'connect-org'");
  });

  it('ships its templates next to dist', () => {
    expect(TEMPLATES_ROOT).toMatch(/templates\/$/);
  });
});

describe('isSeedFile', () => {
  it('protects source and the README', () => {
    expect(isSeedFile('src/index.ts')).toBe(true);
    expect(isSeedFile(join('src', 'infra', 'app.ts'))).toBe(true);
    expect(isSeedFile('README.md')).toBe(true);
  });

  it('leaves managed config files replaceable', () => {
    expect(isSeedFile('tsconfig.json')).toBe(false);
    expect(isSeedFile('.oxlintrc.json')).toBe(false);
    expect(isSeedFile(join('.githooks', 'pre-commit'))).toBe(false);
  });
});

describe('renderTemplateDir with force', () => {
  it('never overwrites a seed file, even when forced', async () => {
    const dir = await scratch();
    await renderTemplateDir('base', dir, VARS, { force: false });

    await writeFile(join(dir, 'src', 'index.ts'), 'export const MINE = 1;\n', 'utf8');
    const report = await renderTemplateDir('base', dir, VARS, { force: true });

    expect(report.skipped).toContain(join('src', 'index.ts'));
    expect(await readFile(join(dir, 'src', 'index.ts'), 'utf8')).toBe('export const MINE = 1;\n');
  });

  it('still replaces managed config when forced', async () => {
    const dir = await scratch();
    await renderTemplateDir('base', dir, VARS, { force: false });

    await writeFile(join(dir, 'tsconfig.json'), '{}', 'utf8');
    await renderTemplateDir('base', dir, VARS, { force: true });

    expect(await readFile(join(dir, 'tsconfig.json'), 'utf8')).toContain('platform-pkg-dev');
  });
});
