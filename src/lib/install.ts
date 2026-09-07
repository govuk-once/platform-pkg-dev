import { spawnSync } from 'node:child_process';
import { dim, error, fail, step } from './log.js';
import { which } from './which.js';

/**
 * Runs `pnpm install` in a package.
 *
 * Shared by `init` and `sync` because both leave a package.json that node_modules
 * does not yet match: writing the manifest only changes what is declared, and
 * until pnpm reconciles it the package claims versions it is not running. Neither
 * command is finished until that has happened, so both install by default.
 *
 * Returns the exit code rather than throwing, so a caller can carry on and
 * report the rest of its work.
 */
export function installDependencies(cwd: string): number {
  if (which('pnpm') === undefined) {
    error('pnpm is not on PATH, so dependencies were not installed.');
    process.stderr.write(`  ${dim('corepack enable pnpm, then run `pnpm install`.')}\n`);
    return 1;
  }

  step('pnpm install');
  const result = spawnSync('pnpm', ['install'], { stdio: 'inherit', cwd });

  if (result.error !== undefined) fail(`Failed to run pnpm install: ${result.error.message}`);
  if (result.signal !== null) fail(`pnpm install terminated with signal ${result.signal}`);

  return result.status ?? 1;
}
