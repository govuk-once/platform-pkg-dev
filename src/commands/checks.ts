import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { bold, dim, error, fail, green, ok, step } from '../lib/log.js';
import { CONFIG_FILE } from '../lib/pre-commit.js';
import { which } from '../lib/which.js';
import { runSync } from './sync.js';
import type { RunContext } from './run.js';

export const PRE_COMMIT_USAGE = `${bold('dev pre-commit')} - run the commit-stage hooks now

Usage
  dev pre-commit [options]

Options
  --changed     Only the files staged in git (the default when git runs the hook)
  --cwd <path>  Run against this package instead of the current directory
  --help        Show this message

Checks the package is in sync first, then runs every pre-commit stage hook in
.pre-commit-config.yaml against all files: file hygiene, detect-secrets,
semgrep, dev lint and dev typecheck.

The sync check runs before pre-commit rather than as a hook inside it, because
pre-commit reads .pre-commit-config.yaml up front - a stale config would run
the wrong hooks and only report itself out of date afterwards.

git runs these automatically once you have run \`dev hooks install\`. This
command is for running them on demand.
`;

export const PRE_PUSH_USAGE = `${bold('dev pre-push')} - run the push-stage hooks now

Usage
  dev pre-push [options]

Options
  --changed     Only the files staged in git
  --cwd <path>  Run against this package instead of the current directory
  --help        Show this message

Checks the package is in sync first, then runs every pre-push stage hook:
checkov and dev test. These are kept off the commit path so committing stays
fast, while nothing unscanned leaves the machine.
`;

type Stage = 'pre-commit' | 'pre-push';

/**
 * Runs one stage of the hook chain through pre-commit.
 *
 * pre-commit owns the chain rather than platform-pkg-dev running the tools itself: it
 * installs each hook into an isolated environment at a pinned revision, so
 * semgrep, checkov and detect-secrets need no global install and cannot drift.
 */
async function runStage(
  stage: Stage,
  argv: readonly string[],
  context: RunContext,
): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(stage === 'pre-commit' ? PRE_COMMIT_USAGE : PRE_PUSH_USAGE);
    return 0;
  }

  if (which('pre-commit') === undefined) {
    error(`pre-commit is not on PATH, so the ${stage} hooks cannot run.`);
    process.stderr.write(`  ${dim('dev doctor')}\n`);
    return 1;
  }

  if (!existsSync(join(context.cwd, CONFIG_FILE))) {
    fail(`${context.cwd} has no ${CONFIG_FILE}.`, 'Run `dev sync` to generate it.');
  }

  // Before pre-commit, not inside it: pre-commit parses the config once at
  // start-up, so this is the only point at which a stale config can still be
  // caught rather than silently used.
  step('sync --check');
  if ((await runSync(['--check'], context)) !== 0) {
    error(`${stage} stopped: this package has drifted from the platform-pkg-dev pins.`);
    process.stderr.write(`  ${dim('Run `dev sync`, then try again.')}\n`);
    return 1;
  }

  const args = ['run', '--hook-stage', stage];
  if (!argv.includes('--changed')) args.push('--all-files');

  const result = spawnSync('pre-commit', args, { stdio: 'inherit', cwd: context.cwd });

  if (result.error !== undefined) {
    error(`Failed to run pre-commit: ${result.error.message}`);
    return 1;
  }

  const status = result.status ?? 1;

  if (status === 0) ok(`${stage} ${green('passed')}`);
  else {
    error(`${stage} failed`);
    const bypass = stage === 'pre-commit' ? 'git commit' : 'git push';
    process.stderr.write(`  ${dim(`${bypass} --no-verify to bypass, if you must.`)}\n`);
  }

  return status;
}

export async function runPreCommit(argv: readonly string[], context: RunContext): Promise<number> {
  return await runStage('pre-commit', argv, context);
}

export async function runPrePush(argv: readonly string[], context: RunContext): Promise<number> {
  return await runStage('pre-push', argv, context);
}
