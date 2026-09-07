import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fail } from './log.js';

const require = createRequire(import.meta.url);

/**
 * Finds the installed root of a dependency of platform-pkg-dev.
 *
 * Resolution starts from platform-pkg-dev's own location rather than the caller's, so
 * consuming packages get the toolchain without needing it as a direct
 * dependency - which pnpm's strict node_modules would otherwise prevent.
 */
export function packageRoot(name: string): string {
  let dir: string;
  try {
    dir = dirname(require.resolve(name));
  } catch {
    fail(
      `Could not resolve "${name}" from platform-pkg-dev.`,
      'Is platform-pkg-dev installed correctly?',
    );
  }

  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string };
      if (parsed.name === name) return dir;
    }

    const parent = dirname(dir);
    if (parent === dir) fail(`Could not locate the package root for "${name}".`);
    dir = parent;
  }
}

/** Absolute path to a dependency's executable entry point. */
export function binPath(packageName: string, binName = packageName): string {
  const root = packageRoot(packageName);
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    bin?: string | Record<string, string>;
  };

  const relativeBin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[binName];

  if (relativeBin === undefined) {
    fail(`"${packageName}" does not declare a "${binName}" binary.`);
  }

  return resolve(root, relativeBin);
}

/**
 * Runs one of the toolchain binaries under the current Node executable,
 * inheriting stdio. Returns its exit code.
 */
export function runTool(
  packageName: string,
  args: readonly string[],
  options: { binName?: string; cwd?: string; stdio?: 'inherit' | 'ignore' } = {},
): number {
  const result = spawnSync(
    process.execPath,
    [binPath(packageName, options.binName ?? packageName), ...args],
    { stdio: options.stdio ?? 'inherit', cwd: options.cwd ?? process.cwd() },
  );

  if (result.error !== undefined) fail(`Failed to run ${packageName}: ${result.error.message}`);
  if (result.signal !== null) fail(`${packageName} terminated with signal ${result.signal}`);

  return result.status ?? 1;
}
