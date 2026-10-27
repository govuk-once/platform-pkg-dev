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

    // .nvmrc, .npmrc, .githooks and .vscode are managed by platform-pkg-dev, not seeded here.
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
    expect(await readFile(join(dir, 'src', 'index.ts'), 'utf8'))
      .toEqual(`import type { SessionToken } from './types.js';

/**
 * Generates a mock session token for a given user.
 */
export function generateToken(userId: string, expiresInMs: number = 3600000): SessionToken {
  if (!userId || userId.trim() === '') {
    throw new Error('Invalid User ID provided for token generation.');
  }

  // Simulate a unique token string (e.g., base64 or hex in a real app)
  const randomStr = Math.random().toString(36).substring(2, 10);

  return {
    token: \`tok_\${userId}_\${randomStr}\`,
    expiresAt: Date.now() + expiresInMs,
    isValid: true,
  };
}

/**
 * Validates a session token against current system time and its internal flag.
 */
export function validateToken(session: SessionToken): boolean {
  if (!session || !session.token) {
    return false;
  }

  if (Date.now() > session.expiresAt) {
    return false;
  }

  return session.isValid;
}
`);
  });

  it('renders the seed test file', async () => {
    const dir = await scratch();
    const report = await renderTemplateDir('base', dir, VARS, { force: false });

    expect(report.written).toContain(join('src', 'index.test.ts'));

    const content = await readFile(join(dir, 'src', 'index.test.ts'), 'utf8');
    expect(content).toContain(
      "import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'",
    );
    expect(content).toContain("import { generateToken, validateToken } from './index.js'");
    expect(content).toContain("describe('Identity Session API'");
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

describe('renderTemplateDir detached', () => {
  it('renders standalone tsconfig with no extends', async () => {
    const dir = await scratch();
    const report = await renderTemplateDir('detached', dir, VARS, { force: false });

    expect(report.written).toContain('tsconfig.json');
    const tsconfig = await readFile(join(dir, 'tsconfig.json'), 'utf8');
    expect(tsconfig).not.toContain('extends');
    expect(tsconfig).toContain('"strict": true');
  });

  it('renders standalone oxlintrc with no extends', async () => {
    const dir = await scratch();
    await renderTemplateDir('detached', dir, VARS, { force: false });

    const oxlintrc = await readFile(join(dir, '.oxlintrc.json'), 'utf8');
    expect(oxlintrc).not.toContain('extends');
    expect(oxlintrc).toContain('"eqeqeq"');
  });

  it('renders standalone vitest config with no platform-pkg-dev import', async () => {
    const dir = await scratch();
    await renderTemplateDir('detached', dir, VARS, { force: false });

    const vitest = await readFile(join(dir, 'vitest.config.ts'), 'utf8');
    expect(vitest).not.toContain('platform-pkg-dev');
    expect(vitest).toContain('vitest/config');
  });

  it('renders standalone githook shims with no platform-pkg-dev reference', async () => {
    const dir = await scratch();
    await renderTemplateDir('detached', dir, VARS, { force: false });

    const hook = await readFile(join(dir, '.githooks', 'pre-commit'), 'utf8');
    expect(hook).not.toContain('platform-pkg-dev');
    expect(hook).toContain('pre-commit');
  });
});
