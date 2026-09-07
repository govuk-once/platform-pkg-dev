import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { bold, dim, error, fail, info, ok, step } from '../lib/log.js';
import { CONFIG_FILE } from '../lib/pre-commit.js';
import { which } from '../lib/which.js';
import { packageDirWithinRepo } from '../lib/git.js';
import type { RunContext } from './run.js';

export const HOOKS_USAGE = `${bold('dev hooks')} - wire up the Once git hooks

Usage
  dev hooks install [options]
  dev hooks status  [options]
  dev hooks uninstall [options]

Options
  --cwd <path>  Run against this package instead of the current directory
  --help        Show this message

install does two things:

  * points git's core.hooksPath at .githooks, so the committed hook scripts
    run - they hand off to pre-commit
  * pre-builds every hook environment, so the first commit is not slow and
    semgrep, checkov and detect-secrets are ready without being on PATH

Both are per-clone: git does not carry core.hooksPath in a checkout, and the
hook environments live in ~/.cache/pre-commit. The hook scripts themselves are
committed, so their contents stay under review like any other file.
`;

const HOOKS_DIR = '.githooks';

/**
 * core.hooksPath is resolved from the git root, so a package nested in a
 * monorepo needs its prefix included.
 */
function hooksPathFor(cwd: string): string {
  const dir = packageDirWithinRepo(cwd);
  return dir === '.' ? HOOKS_DIR : `${dir}/${HOOKS_DIR}`;
}

export async function runHooks(argv: readonly string[], context: RunContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: { help: { type: 'boolean', short: 'h' } },
    allowPositionals: true,
  });

  if (values.help === true || positionals.length === 0) {
    info(HOOKS_USAGE);
    return 0;
  }

  const action = positionals[0];

  switch (action) {
    case 'install':
      return install(context.cwd);
    case 'status':
      return status(context.cwd);
    case 'uninstall':
      return uninstall(context.cwd);
    default:
      error(`Unknown hooks action "${action}".`);
      info(HOOKS_USAGE);
      return 1;
  }
}

function git(cwd: string, args: readonly string[]): { status: number; stdout: string } {
  if (which('git') === undefined) fail('git is not on PATH.');

  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (result.error !== undefined) fail(`Failed to run git: ${result.error.message}`);

  return { status: result.status ?? 1, stdout: (result.stdout ?? '').trim() };
}

function requireRepo(cwd: string): void {
  if (git(cwd, ['rev-parse', '--is-inside-work-tree']).status !== 0) {
    fail(`${cwd} is not inside a git repository.`, 'Run `git init` first.');
  }
}

function install(cwd: string): number {
  requireRepo(cwd);

  if (!existsSync(join(cwd, HOOKS_DIR))) {
    fail(`${HOOKS_DIR}/ does not exist in ${cwd}.`, 'Run `dev init` to scaffold it.');
  }

  const hooksPath = hooksPathFor(cwd);
  const result = git(cwd, ['config', 'core.hooksPath', hooksPath]);
  if (result.status !== 0) {
    error('Could not set core.hooksPath.');
    return result.status;
  }

  ok(`core.hooksPath -> ${hooksPath}`);

  const sign = git(cwd, ['config', 'commit.gpgsign', 'true']);
  if (sign.status !== 0) {
    error('Could not set commit.gpgsign.');
    return sign.status;
  }

  ok('commit.gpgsign -> true');

  return installHookEnvironments(cwd);
}

/**
 * Builds each hook's isolated environment up front.
 *
 * pre-commit would do this lazily on the first commit, which is a surprising
 * multi-minute pause at exactly the wrong moment.
 */
function installHookEnvironments(cwd: string): number {
  if (which('pre-commit') === undefined) {
    error('pre-commit is not on PATH, so the hook environments were not built.');
    process.stderr.write(`  ${dim('dev doctor')}\n`);
    return 1;
  }

  if (!existsSync(join(cwd, CONFIG_FILE))) {
    error(`${CONFIG_FILE} does not exist - run \`dev sync\` to generate it.`);
    return 1;
  }

  step('Building hook environments (first run downloads them)');
  const result = spawnSync('pre-commit', ['install-hooks'], { stdio: 'inherit', cwd });

  if (result.error !== undefined) {
    error(`Failed to run pre-commit: ${result.error.message}`);
    return 1;
  }

  if ((result.status ?? 1) !== 0) return result.status ?? 1;

  ok('Hook environments ready');
  return 0;
}

function status(cwd: string): number {
  requireRepo(cwd);

  const hooksPath = hooksPathFor(cwd);
  const configured = git(cwd, ['config', '--get', 'core.hooksPath']).stdout;

  if (configured === '') {
    error(`core.hooksPath is not set - the Once hooks are not active.`);
    process.stderr.write(`  ${dim('dev hooks install')}\n`);
    return 1;
  }

  if (configured !== hooksPath) {
    error(`core.hooksPath is "${configured}", expected "${hooksPath}".`);
    process.stderr.write(`  ${dim('dev hooks install')}\n`);
    return 1;
  }

  ok(`core.hooksPath is ${hooksPath}`);

  const gpgsign = git(cwd, ['config', '--get', 'commit.gpgsign']).stdout;
  if (gpgsign !== 'true') {
    error('commit.gpgsign is not enabled - commits will not be signed.');
    process.stderr.write(`  ${dim('dev hooks install')}\n`);
    return 1;
  }

  ok('commit.gpgsign is true');
  return 0;
}

function uninstall(cwd: string): number {
  requireRepo(cwd);

  // --unset returns 5 when the key was already absent, which is not a failure.
  const result = git(cwd, ['config', '--unset', 'core.hooksPath']);
  if (result.status !== 0 && result.status !== 5) return result.status;

  ok('core.hooksPath unset - the Once hooks are no longer active.');
  return 0;
}
