import { readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { isMap, parseDocument } from 'yaml';
import { WORKSPACE_SETTINGS } from '../versions.js';

/** pnpm reads its settings from here in pnpm 10, not from .npmrc. */
export const WORKSPACE_FILE = 'pnpm-workspace.yaml';

/** Header written when platform-pkg-dev creates the file from scratch. */
const HEADER = `# pnpm workspace root.
#
# The settings below are owned by platform-pkg-dev and kept current by \`dev sync\` -
# pnpm has no \`extends\` for this file, so they are merged in rather than
# inherited. Everything else here, including the package globs, is yours.
`;

/** Formats a YAML value for reporting without risking [object Object]. */
function show(value: unknown): string {
  const primitive =
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  return primitive ? String(value) : JSON.stringify(value);
}

export interface SettingDrift {
  readonly key: string;
  readonly from: string | undefined;
  readonly to: string;
}

/**
 * Applies platform-pkg-dev's settings to a pnpm-workspace.yaml, preserving the rest.
 *
 * Merged into the parsed document rather than regenerating the file: the
 * `packages:` globs belong to the package, and overwriting them to enforce a
 * few security settings would be a poor trade.
 */
export function applyWorkspaceSettings(content: string): {
  readonly content: string;
  readonly drift: readonly SettingDrift[];
} {
  const doc = parseDocument(content);
  const drift: SettingDrift[] = [];

  // Compared as plain JS rather than YAML nodes, so a list setting such as
  // a list-valued setting would compare by contents rather than by identity.
  const plain = isMap(doc.contents) ? (doc.toJS() as Record<string, unknown>) : {};

  for (const [key, value] of Object.entries(WORKSPACE_SETTINGS)) {
    const current = plain[key];
    if (JSON.stringify(current) === JSON.stringify(value)) continue;

    drift.push({
      key,
      from: current === undefined ? undefined : show(current),
      to: show(value),
    });
    doc.set(key, doc.createNode(value));
  }

  return { content: doc.toString({ lineWidth: 0, flowCollectionPadding: false }), drift };
}

/** Renders a workspace file for a package that has none yet. */
export function renderWorkspaceFile(globs: readonly string[] = ['packages/*']): string {
  const listed = globs.map((glob) => `  - '${glob}'`).join('\n');
  return applyWorkspaceSettings(`${HEADER}packages:\n${listed}\n`).content;
}

/** Reads a package's workspace file, or undefined when it is not one. */
export async function readWorkspaceFile(cwd: string): Promise<string | undefined> {
  try {
    return await readFile(join(cwd, WORKSPACE_FILE), 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Finds the workspace root above a package, if it is a member of one.
 *
 * Walks up looking for a pnpm-workspace.yaml whose globs cover this directory.
 * A member must not be scaffolded like a standalone package: git hooks,
 * pre-commit config and editor settings all belong to the root, and duplicating
 * them lower down produces files that silently never run.
 */
export async function workspaceRootFor(cwd: string): Promise<string | undefined> {
  let dir = resolve(cwd);

  for (;;) {
    const parent = dirname(dir);
    if (parent === dir) return undefined;

    const content = await readWorkspaceFile(parent);
    if (content !== undefined && coversPath(content, relative(parent, cwd))) return parent;

    dir = parent;
  }
}

/** Whether a workspace file's globs cover a path relative to its root. */
function coversPath(content: string, relativePath: string): boolean {
  const parsed = parseDocument(content).toJSON() as { packages?: unknown } | null;
  const globs = parsed?.packages;
  if (!Array.isArray(globs)) return false;

  const segments = relativePath.split(/[\\/]/).filter((part) => part !== '');

  return globs.some((glob) => {
    if (typeof glob !== 'string') return false;

    // Only the shapes pnpm workspaces actually use: `pkgs/*`, `pkgs/**`, or an
    // exact path. Anything more elaborate is not worth guessing at.
    const parts = glob.split('/').filter((part) => part !== '');
    if (parts.at(-1) === '**') {
      return segments.slice(0, parts.length - 1).join('/') === parts.slice(0, -1).join('/');
    }
    if (parts.at(-1) === '*') {
      return (
        segments.length === parts.length &&
        segments.slice(0, -1).join('/') === parts.slice(0, -1).join('/')
      );
    }
    return parts.join('/') === segments.join('/');
  });
}
