import { parseDocument } from 'yaml';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  applyExtend,
  ExtendError,
  preCommitVars,
  renderConfig,
  EXTEND_FILE,
} from './pre-commit.js';
import { revOf } from '../versions.js';

const MASTER = `repos:
  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.5.0
    hooks:
      # keep this comment
      - id: detect-secrets
        exclude: '^(pnpm-lock\\.yaml)$'
  - repo: https://github.com/semgrep/semgrep
    rev: v1.174.0
    hooks:
      - id: semgrep
        args: [--config=p/typescript, --error]
`;

const merge = (extend: unknown): string => {
  const doc = parseDocument(MASTER);
  applyExtend(doc, extend);
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
};

describe('applyExtend', () => {
  it('merges an exclude list into the hook it names', () => {
    const out = merge({
      'detect-secrets': { exclude: ['^docs/fixtures/.*$', '^src/testdata/.*$'] },
    });

    expect(out).toContain('pnpm-lock');
    expect(out).toContain('docs/fixtures');
    expect(out).toContain('src/testdata');
  });

  it('produces a pattern that is still a single valid alternation', () => {
    const out = merge({ 'detect-secrets': { exclude: ['^a$', '^b$'] } });
    const line = out.split('\n').find((l) => l.includes('exclude:')) ?? '';
    const pattern = line
      .slice(line.indexOf('exclude:') + 'exclude:'.length)
      .trim()
      .replace(/^'|'$/g, '');

    // Valid in JS's engine too, which is a decent proxy for "not malformed".
    expect(() => new RegExp(pattern)).not.toThrow();
    expect(new RegExp(pattern).test('a')).toBe(true);
    expect(new RegExp(pattern).test('b')).toBe(true);
  });

  it('hoists a global inline flag to the front rather than burying it in a group', () => {
    const out = merge({ 'detect-secrets': { exclude: ['(?i)^CASE$'] } });
    const line = out.split('\n').find((l) => l.includes('exclude:')) ?? '';

    // Python's re rejects global flags that are not at the start.
    expect(line).toMatch(/exclude:\s*'?\(\?i\)/);
  });

  it('appends args instead of replacing them', () => {
    const out = merge({ semgrep: { args: ['--config=p/owasp-top-ten'] } });

    expect(out).toContain('--config=p/typescript');
    expect(out).toContain('--error');
    expect(out).toContain('--config=p/owasp-top-ten');
  });

  it('replaces scalar fields', () => {
    const out = merge({ semgrep: { verbose: true } });
    expect(out).toContain('verbose: true');
  });

  it('keeps the master comments and formatting', () => {
    expect(merge({ semgrep: { args: ['--x'] } })).toContain('# keep this comment');
  });

  it('appends whole new repos', () => {
    const out = merge({
      repos: [{ repo: 'https://example.com/x', rev: 'v1', hooks: [{ id: 'x' }] }],
    });

    expect(out).toContain('https://example.com/x');
    expect(out).toContain('id: x');
  });

  it('is a no-op for empty extend', () => {
    // Compared against a plain round-trip, not the source text: the YAML
    // library normalises flow sequences, and that is not a change to the config.
    const roundTrip = parseDocument(MASTER).toString({
      lineWidth: 0,
      flowCollectionPadding: false,
    });

    expect(merge({})).toBe(roundTrip);
    expect(merge(null)).toBe(roundTrip);
    expect(merge(undefined)).toBe(roundTrip);
  });

  it('rejects an unknown hook id, and says what is available', () => {
    expect(() => merge({ 'detect-secrts': { exclude: ['x'] } })).toThrow(ExtendError);
    expect(() => merge({ 'detect-secrts': { exclude: ['x'] } })).toThrow(/detect-secrets, semgrep/);
  });

  it('rejects overriding a hook id', () => {
    expect(() => merge({ semgrep: { id: 'other' } })).toThrow(/cannot be overridden/);
  });

  it('rejects a top-level list instead of a mapping', () => {
    expect(() => merge([{ semgrep: {} }])).toThrow(ExtendError);
  });

  it('rejects a non-string exclude entry', () => {
    expect(() => merge({ semgrep: { exclude: [1, 2] } })).toThrow(/must be a string or a list/);
  });
});

describe('renderConfig', () => {
  it('substitutes the pinned revs from versions.json', async () => {
    const out = await renderConfig();

    // Quoting is the template's, not ours: a value starting with `{` would be
    // a YAML flow mapping, so placeholders have to be quoted to parse at all.
    for (const repo of ['semgrep', 'checkov', 'detect-secrets']) {
      expect(out).toContain(`rev: '${revOf(repo)}'`);
    }
    expect(out).not.toContain('{{');
  });

  it('keeps the do-not-edit header', async () => {
    expect(await renderConfig()).toContain('do not edit');
  });

  it('restricts the auto-fixing hooks to the commit stage', async () => {
    const config = parseDocument(await renderConfig()).toJSON() as {
      repos: { hooks: { id: string; stages?: string[] }[] }[];
    };
    const hooks = new Map(config.repos.flatMap((r) => r.hooks.map((h) => [h.id, h])));

    // Upstream declares [pre-commit, pre-push, manual]; an auto-fixer running on
    // push would rewrite files mid-push and leave a dirty tree.
    for (const id of [
      'trailing-whitespace',
      'end-of-file-fixer',
      'check-executables-have-shebangs',
      'check-added-large-files',
    ]) {
      expect(hooks.get(id)?.stages, `${id} must be commit-only`).toEqual(['pre-commit']);
    }

    expect(hooks.get('checkov')?.stages).toEqual(['pre-push']);
    expect(hooks.get('dev-test')?.stages).toEqual(['pre-push']);
  });

  it('is stable, so sync does not report phantom drift', async () => {
    expect(await renderConfig()).toBe(await renderConfig());
  });

  it('reports invalid extend YAML against the right filename', async () => {
    await expect(renderConfig('a:\n  - b\n c: broken')).rejects.toThrow(EXTEND_FILE);
  });
});

describe('preCommitVars', () => {
  const savedBin = process.env['DEV_BIN'];
  beforeEach(() => {
    delete process.env['DEV_BIN'];
  });
  afterEach(() => {
    if (savedBin !== undefined) process.env['DEV_BIN'] = savedBin;
    else delete process.env['DEV_BIN'];
  });

  it('calls the binary in place when the package is the repository root', () => {
    const vars = preCommitVars('.');

    expect(vars['devBin']).toBe('./node_modules/.bin/dev');
    expect(vars['devCwd']).toBe('');
    expect(vars['pathPrefix']).toBe('');
  });

  it('prefixes everything when the package is nested in a monorepo', () => {
    const vars = preCommitVars('connect-org');

    // pre-commit runs hooks from the git root, so an unprefixed path would
    // resolve against the wrong directory.
    expect(vars['devBin']).toBe('./connect-org/node_modules/.bin/dev');
    expect(vars['devCwd']).toBe(' --cwd connect-org');
    expect(vars['pathPrefix']).toBe('connect-org/');
  });
});

describe('renderConfig for a nested package', () => {
  const savedBin = process.env['DEV_BIN'];
  beforeEach(() => {
    delete process.env['DEV_BIN'];
  });
  afterEach(() => {
    if (savedBin !== undefined) process.env['DEV_BIN'] = savedBin;
    else delete process.env['DEV_BIN'];
  });

  it('points the local hooks at the package, not the git root', async () => {
    const out = await renderConfig(undefined, 'connect-org');

    expect(out).toContain('./connect-org/node_modules/.bin/dev lint --cwd connect-org');
    expect(out).toContain('./connect-org/node_modules/.bin/dev typecheck --cwd connect-org');
    expect(out).not.toContain('pnpm exec dev');
  });

  it('does not make the sync check a hook inside the chain', async () => {
    // pre-commit parses this file up front, so a sync hook here would validate
    // a config that had already been used. It runs before pre-commit instead.
    const out = await renderConfig(undefined, 'connect-org');

    const config = parseDocument(out).toJSON() as {
      repos: { hooks: { id: string; entry?: string }[] }[];
    };
    const hooks = config.repos.flatMap((r) => r.hooks);

    expect(hooks.map((h) => h.id)).not.toContain('dev-sync');
    expect(hooks.filter((h) => h.entry?.includes('sync'))).toEqual([]);
  });

  it('anchors the master exclusions so they survive a path prefix', async () => {
    const out = await renderConfig(undefined, 'connect-org');

    // `^pnpm-lock.yaml` would never match `connect-org/pnpm-lock.yaml`.
    expect(out).toContain('(^|/)(pnpm-lock');
    expect(out).toContain('(^|/)(\\.oxlintrc');
  });
});
