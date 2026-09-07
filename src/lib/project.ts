import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fail } from './log.js';

/**
 * Walks up from `start` to the nearest directory containing a package.json.
 *
 * Every toolchain wrapper runs from this directory rather than the raw cwd, so
 * `dev lint` behaves identically whether it is invoked from the package
 * root or from three directories down inside src/.
 */
export function findProjectRoot(start: string = process.cwd()): string {
  let dir = resolve(start);

  for (;;) {
    if (existsSync(join(dir, 'package.json'))) return dir;

    const parent = dirname(dir);
    if (parent === dir) {
      fail(
        `No package.json found in ${resolve(start)} or any parent directory.`,
        'Run platform-pkg-dev from inside a package, or pass --cwd <path>.',
      );
    }
    dir = parent;
  }
}

/**
 * Resolves the directory the toolchain should run in.
 *
 * Precedence: explicit `--cwd`, then the DEV_CWD environment variable
 * (useful for hooks and CI wrappers), then the nearest package root.
 */
export function resolveWorkingDir(explicit?: string | undefined): string {
  const requested = explicit ?? process.env['DEV_CWD'];

  if (requested !== undefined && requested !== '') {
    const dir = resolve(requested);
    if (!existsSync(dir)) fail(`--cwd path does not exist: ${dir}`);
    return findProjectRoot(dir);
  }

  return findProjectRoot();
}
