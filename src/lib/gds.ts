import { spawnSync } from 'node:child_process';
import { dim, fail } from './log.js';
import { which } from './which.js';

/** The command that mints short-lived credentials for a GDS role. */
export const GDS_CLI = 'gds-cli';

/**
 * Environment variables a credential block is allowed to set.
 *
 * An allowlist rather than "whatever came back": the output is evaluated into
 * the environment of a process that then talks to AWS, so anything outside
 * this set - PATH, NODE_OPTIONS, AWS_PROFILE - would be a way to change what
 * that process does, not just who it does it as.
 */
const CREDENTIAL_VARS = new Set([
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_SECURITY_TOKEN',
  'AWS_SESSION_EXPIRATION',
  'AWS_DEFAULT_REGION',
  'AWS_REGION',
]);

/**
 * Reads `export KEY='value'` lines into a plain object.
 *
 * Parsed rather than `eval`ed. The upstream scripts run `eval "$CREDS"`, which
 * hands whatever the command printed to the shell - a single backtick in an
 * error message is enough to run something. Parsing cannot execute anything,
 * and unknown keys are dropped rather than exported.
 */
export function parseCredentials(output: string): Record<string, string> {
  const credentials: Record<string, string> = {};

  for (const line of output.split('\n')) {
    // 1. Trim line and optionally drop a trailing semicolon
    const sanitizedLine = line.trim().replace(/;$/, '');

    // 2. Extract key and raw value
    const match = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(sanitizedLine);
    if (match === null) continue;

    const [, key, rawValue = ''] = match;
    if (key === undefined || !CREDENTIAL_VARS.has(key)) continue;

    // 3. Trim whitespace from value, then strip matching surrounding quotes
    let value = rawValue.trim();
    if (/^(['"]).*\1$/s.test(value)) {
      value = value.slice(1, -1);
    }

    credentials[key] = value;
  }

  return credentials;
}

/** Whether a credential set is complete enough to sign a request. */
export function hasCredentials(credentials: Record<string, string>): boolean {
  return (
    credentials['AWS_ACCESS_KEY_ID'] !== undefined &&
    credentials['AWS_SECRET_ACCESS_KEY'] !== undefined
  );
}

/**
 * Assumes a GDS role and returns the credentials it minted.
 *
 * Never writes them to disk and never puts them in a process argument, so they
 * cannot be read out of `ps` or left behind in a file.
 */
export function assumeRole(role: string): Record<string, string> {
  if (which(GDS_CLI) === undefined) {
    fail(
      `${GDS_CLI} is not on PATH, so the role could not be assumed.`,
      'Install the GDS CLI: https://github.com/alphagov/gds-cli',
    );
  }

  const result = spawnSync(GDS_CLI, ['aws', role, '-e'], { encoding: 'utf8' });
  if (result.error !== undefined) {
    fail(`Failed to run ${GDS_CLI}: ${result.error.message}`);
  }

  if ((result.status ?? 1) !== 0) {
    fail(
      `Could not assume "${role}".`,
      `${(result.stderr ?? '').trim()}\n  ${dim('Are you on the VPN or an office IP range?')}`,
    );
  }

  const credentials = parseCredentials(result.stdout ?? '');

  if (!hasCredentials(credentials)) {
    fail(
      `${GDS_CLI} returned no usable credentials for "${role}".`,
      'Expected an AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in its output.',
    );
  }

  return credentials;
}

/**
 * Confirms the credentials actually work before anything long-running starts.
 *
 * A role can be assumed and still be unusable - off-VPN is the common one -
 * and finding that out from a failed synth several seconds later is a much
 * worse error message than this one.
 */
export function verifyCredentials(credentials: Record<string, string>): void {
  if (which('aws') === undefined) return;

  const result = spawnSync('aws', ['sts', 'get-caller-identity'], {
    env: { ...process.env, ...credentials },
    encoding: 'utf8',
  });

  if ((result.status ?? 1) !== 0) {
    fail(
      'The role was assumed but its credentials are not usable.',
      `${(result.stderr ?? '').trim()}\n  ${dim('Check the VPN.')}`,
    );
  }
}
