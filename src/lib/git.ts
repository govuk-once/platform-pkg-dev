import { spawnSync } from 'node:child_process';
import { relative, sep } from 'node:path';
import { which } from './which.js';

/**
 * Locates the git repository containing a package.
 *
 * Returns undefined when the directory is not in a repository - `dev init`
 * must still work before `git init` has been run.
 */
export function gitRoot(cwd: string): string | undefined {
  if (which('git') === undefined) return undefined;

  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return undefined;

  const root = (result.stdout ?? '').trim();
  return root === '' ? undefined : root;
}

/**
 * The package's path relative to its git root, POSIX-style, or `.` when the
 * package is the repository root (or is not in a repository at all).
 *
 * pre-commit runs every hook from the git root, so this is what makes the
 * generated config correct for a package nested inside a monorepo.
 */
export function packageDirWithinRepo(packageRoot: string): string {
  const root = gitRoot(packageRoot);
  if (root === undefined) return '.';

  const rel = relative(root, packageRoot);
  if (rel === '' || rel.startsWith('..')) return '.';

  return rel.split(sep).join('/');
}
