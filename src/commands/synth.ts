import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { assumeRole, verifyCredentials } from '../lib/gds.js';
import { bold, dim, fail, info, ok, step } from '../lib/log.js';
import type { RunContext } from './run.js';

export const SYNTH_USAGE = `${bold('dev synth')} - assume a GDS role, then synthesise the CDK app

Usage
  dev synth [stack...] [options]

Options
  --env <name>   Which role to assume, by key (default: $ENV, else the only one)
  --role <name>  Assume this role directly, ignoring the configured ones
  --region <r>   AWS region (default: the configured one, else eu-west-2)
  --dir <name>   CDK directory, relative to the package (default: cdk)
  --no-clean     Keep the existing cdk.out instead of removing it first
  --cwd <path>   Run against this package instead of the current directory
  --help         Show this message

Roles are declared in package.json, so the name is not repeated in a script:

  "once": {
    "team": "platform",
    "aws": {
      "region": "eu-west-2",
      "roles": { "dev": "once-udp-development-admin" }
    }
  }

Credentials are read from \`gds-cli aws <role> -e\` and passed to cdk as
environment variables. They are never written to disk, never placed in a
process argument, and never evaluated as shell.
`;

type AwsConfig = {
  region?: string;
  roles?: Record<string, string>;
};

/** The `once.aws` block, if the package declares one. */
export function readAwsConfig(cwd: string): AwsConfig {
  try {
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
      once?: { aws?: AwsConfig };
    };
    return manifest.once?.aws ?? {};
  } catch {
    return {};
  }
}

/**
 * Picks the role to assume.
 *
 * A single configured role needs no `--env`: naming an environment when there
 * is only one to choose from is ceremony. More than one and the choice has to
 * be explicit, because assuming the wrong account is not a mistake worth making
 * quietly.
 */
export function resolveRole(
  config: AwsConfig,
  options: { role?: string | undefined; env?: string | undefined },
): string {
  if (options.role !== undefined) return options.role;

  const roles = config.roles ?? {};
  const names = Object.keys(roles);

  if (names.length === 0) {
    return fail(
      'No AWS role is configured for this package.',
      'Add once.aws.roles to package.json, or pass --role. See `dev synth --help`.',
    );
  }

  const env = options.env ?? process.env['ENV'];

  if (env === undefined) {
    const [only] = names;
    if (names.length === 1 && only !== undefined) return roles[only] as string;

    return fail(
      'This package declares more than one role, so one has to be named.',
      `--env <${names.join('|')}>, or set ENV.`,
    );
  }

  const role = roles[env];
  if (role === undefined) {
    return fail(`No role is configured for "${env}".`, `Configured: ${names.join(', ')}`);
  }

  return role;
}

export async function runSynth(argv: readonly string[], context: RunContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      env: { type: 'string' },
      role: { type: 'string' },
      region: { type: 'string' },
      dir: { type: 'string' },
      'no-clean': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help === true) {
    info(SYNTH_USAGE);
    return 0;
  }

  const config = readAwsConfig(context.cwd);
  const role = resolveRole(config, { role: values.role, env: values.env });
  const region = values.region ?? config.region ?? 'eu-west-2';

  const cdkDir = join(context.cwd, values.dir ?? 'cdk');
  if (!existsSync(cdkDir)) {
    fail(
      `${values.dir ?? 'cdk'}/ does not exist in this package.`,
      'Run `dev cdk:init` to scaffold it.',
    );
  }

  const cdk = join(context.cwd, 'node_modules', '.bin', 'cdk');
  if (!existsSync(cdk)) {
    fail('The CDK CLI is not installed for this package.', 'Run `pnpm install` first.');
  }

  step(`Assuming ${role}`);
  const credentials = assumeRole(role);
  verifyCredentials(credentials);
  ok(`Assumed ${role}`);

  // A stale cdk.out is worse than none: a template left from a previous run is
  // still scanned by checkov, so a stack you have since deleted keeps failing.
  if (values['no-clean'] !== true) {
    await rm(join(cdkDir, 'cdk.out'), { recursive: true, force: true });
  }

  step(positionals.length > 0 ? `Synthesising ${positionals.join(', ')}` : 'Synthesising');

  const result = spawnSync(cdk, ['synth', '--quiet', ...positionals], {
    cwd: cdkDir,
    stdio: 'inherit',
    env: { ...process.env, ...credentials, CDK_DEFAULT_REGION: region },
  });

  if (result.error !== undefined) fail(`Failed to run cdk: ${result.error.message}`);
  if ((result.status ?? 1) !== 0) return result.status ?? 1;

  ok(`Synthesised to ${join(values.dir ?? 'cdk', 'cdk.out')}`);
  info(dim('  dev scan   # run checkov over the synthesised templates'));

  return 0;
}
