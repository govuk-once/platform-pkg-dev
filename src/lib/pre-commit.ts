import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isMap, isSeq, parseDocument, type Document, type YAMLMap } from 'yaml';
import { substitute, TEMPLATES_ROOT } from './render.js';
import { revOf } from '../versions.js';

/** The rendered file every Once package carries. Owned by platform-pkg-dev. */
export const CONFIG_FILE = '.pre-commit-config.yaml';

/** Where a package overrides or adds hooks for itself alone. */
export const EXTEND_FILE = 'pre-commit.extend.yaml';

/** Master config shipped with platform-pkg-dev, relative to the templates root. */
const MASTER = join('pre-commit', 'master.yaml');

/** Hook repos the master config pins, and their versions.json keys. */
export const MANAGED_REPOS: readonly { readonly url: string; readonly key: string }[] = [
  { url: 'https://github.com/pre-commit/pre-commit-hooks', key: 'pre-commit-hooks' },
  { url: 'https://github.com/Yelp/detect-secrets', key: 'detect-secrets' },
  { url: 'https://github.com/semgrep/semgrep', key: 'semgrep' },
  { url: 'https://github.com/bridgecrewio/checkov', key: 'checkov' },
  { url: 'https://github.com/rhysd/actionlint', key: 'actionlint' },
];

/**
 * Where the package sits relative to the git root, as a POSIX path.
 *
 * pre-commit always runs hooks from the git root and reports paths relative to
 * it, so in a monorepo a package's own files arrive prefixed. `.` means the
 * package is the repository.
 */
export type PackageDir = string;

/** Placeholders the master config substitutes. */
export function preCommitVars(packageDir: PackageDir = '.'): Record<string, string> {
  const nested = packageDir !== '.' && packageDir !== '';
  const prefix = nested ? `${packageDir.replace(/\/+$/, '')}/` : '';

  return {
    preCommitHooksRev: revOf('pre-commit-hooks'),
    detectSecretsRev: revOf('detect-secrets'),
    semgrepRev: revOf('semgrep'),
    checkovRev: revOf('checkov'),
    actionlintRev: revOf('actionlint'),

    // Direct binary, not `pnpm exec`: hooks run from the git root, which in a
    // monorepo has no package.json for corepack to read a pnpm version from.
    devBin: process.env['DEV_BIN'] ?? `./${prefix}node_modules/.bin/dev`,
    devCwd: nested ? ` --cwd ${prefix.replace(/\/$/, '')}` : '',
    pathPrefix: prefix.replace(/\./g, '\\.'),
  };
}

/**
 * Fields that take a list in the extend file but a single regex in pre-commit.
 *
 * `exclude: [a, b]` is far easier to read and review than the alternation
 * pre-commit actually wants, so the entries are joined here instead.
 */
const REGEX_FIELDS = new Set(['exclude', 'files']);

/** Fields where a package's entries are added to the master's, not replacing them. */
const APPEND_FIELDS = new Set(['args', 'additional_dependencies', 'types_or', 'exclude_types']);

export class ExtendError extends Error {}

/**
 * Leading global inline flags, e.g. `(?x)` or `(?im)`.
 *
 * In Python's `re` these apply to the whole pattern and must come first, so
 * wrapping one in a group either warns or changes behaviour. Any that appear
 * are hoisted back to the front of the merged pattern.
 */
const LEADING_FLAGS = /^\(\?([aiLmsux]+)\)/;

function splitFlags(pattern: string): { flags: string; body: string } {
  const match = LEADING_FLAGS.exec(pattern);
  if (match === null) return { flags: '', body: pattern };
  return { flags: match[1] ?? '', body: pattern.slice(match[0].length) };
}

/** Joins regex fragments into one alternation, keeping any existing pattern. */
function mergePattern(existing: unknown, additions: readonly string[]): string {
  const parts = additions.filter((part) => part.trim() !== '');
  if (parts.length === 0) return typeof existing === 'string' ? existing : '';

  const collected: string[] = [];
  const branches: string[] = [];

  const take = (pattern: string): void => {
    const { flags, body } = splitFlags(pattern);
    if (flags !== '') collected.push(flags);
    branches.push(`(?:${body})`);
  };

  if (typeof existing === 'string' && existing.trim() !== '') take(existing);
  for (const part of parts) take(part);

  const flags = [...new Set(collected.join(''))].join('');
  return `${flags === '' ? '' : `(?${flags})`}${branches.join('|')}`;
}

function asStringList(value: unknown, hookId: string, field: string): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value;
  }
  throw new ExtendError(
    `${EXTEND_FILE}: "${hookId}.${field}" must be a string or a list of strings.`,
  );
}

/** Indexes every hook in the document by its id, so overrides can find it. */
function indexHooks(doc: Document): Map<string, YAMLMap> {
  const index = new Map<string, YAMLMap>();
  const repos = doc.get('repos');
  if (!isSeq(repos)) return index;

  for (const repo of repos.items) {
    if (!isMap(repo)) continue;
    const hooks = repo.get('hooks');
    if (!isSeq(hooks)) continue;

    for (const hook of hooks.items) {
      if (!isMap(hook)) continue;
      const id = hook.get('id');
      if (typeof id === 'string') index.set(id, hook);
    }
  }

  return index;
}

/**
 * Applies a package's extend to the rendered master.
 *
 * Top-level keys name a hook id and merge into that hook. A `repos:` key adds
 * entirely new hook repos. Merging into the parsed document rather than
 * splicing text keeps the master's comments and formatting intact.
 */
export function applyExtend(doc: Document, extend: unknown): string[] {
  if (extend === null || extend === undefined) return [];

  if (typeof extend !== 'object' || Array.isArray(extend)) {
    throw new ExtendError(`${EXTEND_FILE} must be a mapping of hook id to overrides.`);
  }

  const applied: string[] = [];
  const hooks = indexHooks(doc);

  for (const [key, value] of Object.entries(extend as Record<string, unknown>)) {
    if (key === 'repos') {
      const repos = doc.get('repos');
      if (!isSeq(repos)) throw new ExtendError('The master config has no repos list.');
      if (!Array.isArray(value)) {
        throw new ExtendError(`${EXTEND_FILE}: "repos" must be a list of hook repos.`);
      }
      for (const repo of value) repos.add(doc.createNode(repo));
      applied.push(`repos (+${value.length})`);
      continue;
    }

    const hook = hooks.get(key);
    if (hook === undefined) {
      throw new ExtendError(
        `${EXTEND_FILE}: no hook named "${key}" in the platform-pkg-dev config.\n` +
          `  Available: ${[...hooks.keys()].join(', ')}`,
      );
    }

    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ExtendError(`${EXTEND_FILE}: "${key}" must be a mapping of fields to values.`);
    }

    for (const [field, override] of Object.entries(value as Record<string, unknown>)) {
      if (field === 'id') {
        throw new ExtendError(`${EXTEND_FILE}: "${key}.id" cannot be overridden.`);
      }

      if (REGEX_FIELDS.has(field)) {
        hook.set(field, mergePattern(hook.get(field), asStringList(override, key, field)));
        continue;
      }

      if (APPEND_FIELDS.has(field)) {
        const existing = hook.get(field);
        const current: unknown[] = isSeq(existing) ? existing.toJSON() : [];
        hook.set(field, doc.createNode([...current, ...asStringList(override, key, field)]));
        continue;
      }

      hook.set(field, doc.createNode(override));
    }

    applied.push(`${key} (${Object.keys(value).join(', ')})`);
  }

  return applied;
}

/**
 * Renders the config a package should have: platform-pkg-dev's master with the pinned
 * revs substituted, then this package's extend merged in.
 */
export async function renderConfig(
  extend?: string | undefined,
  packageDir: PackageDir = '.',
): Promise<string> {
  const master = await readFile(join(TEMPLATES_ROOT, MASTER), 'utf8');
  const doc = parseDocument(substitute(master, preCommitVars(packageDir)));

  if (extend !== undefined && extend.trim() !== '') {
    const parsed = parseDocument(extend);
    if (parsed.errors.length > 0) {
      throw new ExtendError(`${EXTEND_FILE} is not valid YAML: ${parsed.errors[0]?.message ?? ''}`);
    }
    applyExtend(doc, parsed.toJSON());
  }

  // flowCollectionPadding matches oxfmt, which compacts `[ a ]` to `[a]`.
  // Without this the formatter and this renderer rewrite each other forever.
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/**
 * Line-level summary of how a package's config differs from the rendered one,
 * so `sync --check` can say what changed rather than just "it differs".
 */
export function describeConfigDrift(
  current: string,
  rendered: string,
): { readonly added: readonly string[]; readonly removed: readonly string[] } {
  const tally = (text: string): Map<string, number> => {
    const counts = new Map<string, number>();
    for (const line of text.split('\n')) {
      const key = line.trim();
      if (key === '' || key.startsWith('#')) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };

  const before = tally(current);
  const after = tally(rendered);

  return {
    added: [...after.keys()].filter((line) => (before.get(line) ?? 0) < (after.get(line) ?? 0)),
    removed: [...before.keys()].filter((line) => (after.get(line) ?? 0) < (before.get(line) ?? 0)),
  };
}
