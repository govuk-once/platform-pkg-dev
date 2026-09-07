import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { bold, dim, error, fail, info, ok, step } from '../lib/log.js';
import { which } from '../lib/which.js';
import { runSynth } from './synth.js';
import type { RunContext } from './run.js';

export const SCAN_USAGE = `${bold('dev scan')} - synthesise, then run checkov over the templates

Usage
  dev scan [check] [options]

Options
  --no-synth     Scan the existing cdk.out instead of synthesising first
  --dir <name>   CDK directory, relative to the package (default: cdk)
  --env <name>   Passed through to \`dev synth\`
  --role <name>  Passed through to \`dev synth\`
  --cwd <path>   Run against this package instead of the current directory
  --help         Show this message

Scanning synthesised templates rather than source is the point: checkov reads
CloudFormation, and a construct's real properties - including everything CDK
fills in for you - only exist after synth.

  dev scan                 # every check
  dev scan CKV_AWS_158     # one check, while fixing it

The pre-push hook runs checkov too, but over files rather than templates. This
is the one to trust before a deployment.
`;

type CheckovResults = {
  summary?: { passed?: number; failed?: number; skipped?: number };
  results?: { failed_checks?: FailedCheck[] };
};

type FailedCheck = {
  check_id?: string;
  check_name?: string;
  file_path?: string;
  resource?: string;
};

/**
 * Groups failures by check, worst first.
 *
 * Checkov's own output lists every failure separately, which for one bad
 * default across forty resources is forty near-identical blocks. Grouping says
 * "this one rule, forty times" - which is one fix, not forty.
 */
export function summarise(failures: readonly FailedCheck[]): string[] {
  const groups = new Map<string, FailedCheck[]>();

  for (const failure of failures) {
    const id = failure.check_id ?? 'unknown';
    const group = groups.get(id);
    if (group === undefined) groups.set(id, [failure]);
    else group.push(failure);
  }

  const lines: string[] = [];

  for (const [id, group] of [...groups.entries()].toSorted((a, b) => b[1].length - a[1].length)) {
    lines.push(`  ${id}  x${group.length}  ${group[0]?.check_name ?? ''}`);
    for (const failure of group) {
      lines.push(`      ${failure.resource ?? ''}  ${dim(failure.file_path ?? '')}`);
    }
  }

  return lines;
}

export async function runScan(argv: readonly string[], context: RunContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      'no-synth': { type: 'boolean' },
      dir: { type: 'string' },
      env: { type: 'string' },
      role: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help === true) {
    info(SCAN_USAGE);
    return 0;
  }

  if (which('checkov') === undefined) {
    fail(
      'checkov is not on PATH.',
      'The pre-commit hooks fetch their own copy, but this command needs one directly.\n' +
        '  pipx install checkov, then `dev doctor` to confirm the pinned version.',
    );
  }

  const dir = values.dir ?? 'cdk';

  if (values['no-synth'] !== true) {
    const synthArgs = [
      ...(values.env === undefined ? [] : ['--env', values.env]),
      ...(values.role === undefined ? [] : ['--role', values.role]),
      '--dir',
      dir,
    ];

    const status = await runSynth(synthArgs, context);
    if (status !== 0) return status;
  }

  const out = join(context.cwd, dir, 'cdk.out');
  if (!existsSync(out)) {
    fail(`${join(dir, 'cdk.out')} does not exist.`, 'Run without --no-synth to synthesise first.');
  }

  step('Scanning with checkov');

  const config = join(context.cwd, '.checkov.yaml');
  const result = spawnSync(
    'checkov',
    [
      '-d',
      out,
      ...(existsSync(config) ? ['--config-file', config] : []),
      ...(positionals[0] === undefined ? [] : ['--check', positionals[0]]),
      '-o',
      'json',
      '--quiet',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );

  if (result.error !== undefined) fail(`Failed to run checkov: ${result.error.message}`);

  let parsed: CheckovResults;
  try {
    // A run with several frameworks returns an array, one entry per framework.
    const raw = JSON.parse(result.stdout ?? '') as CheckovResults | CheckovResults[];
    parsed = Array.isArray(raw) ? (raw[0] ?? {}) : raw;
  } catch {
    error('checkov produced no parseable results - the scan errored.');
    process.stderr.write(`${(result.stderr ?? '').trim()}\n`);
    return 1;
  }

  const { passed = 0, failed = 0, skipped = 0 } = parsed.summary ?? {};
  info(`  ${passed} passed, ${failed} failed, ${skipped} skipped`);

  if (failed === 0) {
    ok('Checkov passed');
    return 0;
  }

  error(`Checkov found ${failed} issue${failed === 1 ? '' : 's'}:`);
  for (const line of summarise(parsed.results?.failed_checks ?? [])) {
    process.stderr.write(`${line}\n`);
  }

  process.stderr.write(
    `\n  ${dim('Fix it, or suppress it with a reason - see the checkov package in once-org.')}\n`,
  );

  return 1;
}
