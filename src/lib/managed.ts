import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderFormatConfig, FORMAT_CONFIG_FILE } from './format.js';
import { CONFIG_FILE, renderConfig } from './pre-commit.js';
import { planTemplateDir, substitute, targetName, TEMPLATES_ROOT } from './render.js';
import { NODE_MAJOR } from '../versions.js';

/**
 * Files platform-pkg-dev owns outright in every package.
 *
 * A package's tsconfig and .oxlintrc.json are not here: those formats support
 * `extends`, so they point back at platform-pkg-dev and a change propagates
 * without anything being rewritten. Everything below is a format with no such
 * mechanism - shell scripts, editor settings, pre-commit's YAML - so the only
 * way to keep them consistent is for platform-pkg-dev to generate them and
 * `dev sync` to regenerate them.
 *
 * Deliberately excluded: .gitignore, README.md and src/, which packages are
 * expected to add to.
 */
const MANAGED_TEMPLATE_DIR = 'managed';

/**
 * Templates that exist only to show what a package-specific file could contain.
 *
 * Each is dropped once its real counterpart exists: an example sitting next to
 * the thing it was an example of is just clutter. They are gitignored via
 * `*.example`, so a package never commits them.
 */
const EXAMPLE_TEMPLATE_DIR = 'examples';

/**
 * Files that belong to a repository, not to each package inside one.
 *
 * git resolves core.hooksPath once per repository, pre-commit reads a single
 * config, and VS Code only reads .vscode from the folder you open - so copies
 * of these in a workspace member are files that can never run.
 */
const ROOT_ONLY = [
  '.githooks/',
  '.vscode/',
  '.nvmrc',
  '.pre-commit-config.yaml',
  '.claude/',
  '.env.example',
  'pre-commit.extend.yaml.example',
  // oxlint and oxfmt walk up for the nearest config, so the root's applies to
  // every package beneath it. A copy in each member would only be a chance for
  // them to disagree.
  '.oxlintrc.json',
  '.oxfmtrc.json',
];

function isRootOnly(path: string): boolean {
  return ROOT_ONLY.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));
}

const EXAMPLE_SUFFIX = '.example';

export interface ManagedContext {
  /** Package root. */
  readonly cwd: string;
  /**
   * True when this package is a member of a workspace rather than a repository
   * of its own. Members get the config that applies per package and none of the
   * config that belongs to the root.
   */
  readonly isMember?: boolean;
  /** Package path relative to the git root, for the pre-commit config. */
  readonly packageDir: string;
  /** Contents of pre-commit.extend.yaml, if the package has one. */
  readonly extend: string | undefined;
}

export interface ManagedFile {
  /** Path relative to the package root. */
  readonly path: string;
  readonly content: string;
  /** Set for files that are only useful when executable. */
  readonly mode?: number | undefined;
}

/** Variables the managed templates substitute. */
function templateVars(): Record<string, string> {
  return { nodeMajor: String(NODE_MAJOR) };
}

/**
 * Renders every file platform-pkg-dev owns, ready to be compared or written.
 *
 * init and sync both go through this, so a freshly scaffolded package is in
 * sync by construction rather than by two code paths happening to agree.
 */
export async function renderManagedFiles(context: ManagedContext): Promise<ManagedFile[]> {
  const files: ManagedFile[] = [];

  for (const relative of await planTemplateDir(MANAGED_TEMPLATE_DIR, '.')) {
    const source = join(TEMPLATES_ROOT, MANAGED_TEMPLATE_DIR, sourceName(relative));
    const raw = await readFile(source, 'utf8');

    files.push({
      path: relative,
      content: substitute(raw, templateVars()),
      // Git hook scripts are inert unless executable.
      mode: relative.startsWith('.githooks') ? 0o755 : undefined,
    });
  }

  files.push({
    path: CONFIG_FILE,
    content: await renderConfig(context.extend, context.packageDir),
  });

  files.push({ path: FORMAT_CONFIG_FILE, content: await renderFormatConfig() });

  return files
    .filter((file) => !(context.isMember === true && isRootOnly(file.path)))
    .toSorted((a, b) => a.path.localeCompare(b.path));
}

/**
 * Renders the example files a package still needs.
 *
 * An example whose real counterpart already exists is omitted, so `dev sync`
 * neither creates nor re-creates it. One that is missing while its counterpart
 * is also missing gets written, which is what makes the prompt survive a
 * platform-pkg-dev upgrade that changes the guidance.
 */
export async function renderExampleFiles(context: ManagedContext): Promise<ManagedFile[]> {
  const files: ManagedFile[] = [];

  for (const relative of await planTemplateDir(EXAMPLE_TEMPLATE_DIR, '.')) {
    if (context.isMember === true && isRootOnly(relative)) continue;

    const real = relative.slice(0, -EXAMPLE_SUFFIX.length);
    if (existsSync(join(context.cwd, real))) continue;

    const source = join(TEMPLATES_ROOT, EXAMPLE_TEMPLATE_DIR, sourceName(relative));
    files.push({
      path: relative,
      content: substitute(await readFile(source, 'utf8'), templateVars()),
    });
  }

  return files
    .filter((file) => !(context.isMember === true && isRootOnly(file.path)))
    .toSorted((a, b) => a.path.localeCompare(b.path));
}

/** Maps a rendered path back to its template name (`.githooks` -> `_githooks`). */
function sourceName(relativePath: string): string {
  return relativePath
    .split('/')
    .map((segment) => (segment.startsWith('.') ? `_${segment.slice(1)}` : segment))
    .join('/');
}

/** Writes one managed file, creating parent directories as needed. */
export async function writeManagedFile(cwd: string, file: ManagedFile): Promise<void> {
  const destination = join(cwd, file.path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, file.content, 'utf8');
  if (file.mode !== undefined) await chmod(destination, file.mode);
}

/** Reads a managed file's current contents, or undefined if absent. */
export async function readManagedFile(cwd: string, file: ManagedFile): Promise<string | undefined> {
  try {
    return await readFile(join(cwd, file.path), 'utf8');
  } catch {
    return undefined;
  }
}

export { targetName };
