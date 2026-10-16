import { parseArgs } from 'node:util';
import { assumeRole, authoriseCodeArtifact, verifyCredentials } from '../lib/gds.js';
import { bold, info, ok, step } from '../lib/log.js';
import { CODE_ARTIFACT_ACCOUNT } from '../versions.js';
import { readAwsConfig, resolveRole } from './synth.js';
import type { RunContext } from './run.js';

export const ASSUME_ROLE_USAGE = `${bold('dev assumeRole')} - assume a GDS role and print credentials

Usage
  dev assumeRole [role] [options]

Options
  --env <name>  Which configured role to use (when more than one exists)
  --verify      Confirm the credentials work (calls sts:GetCallerIdentity)
  --export      Print credentials as export statements for eval
  --cwd <path>  Run against this package instead of the current directory
  --help        Show this message

When no role is given, uses the role from once.aws.roles in package.json.
With --export the output is suitable for eval:

  eval "$(dev assumeRole --export)"

Credentials are never written to disk and never placed in a process argument.
`;

export const CODE_ARTIFACT_USAGE = `${bold('dev codeArtifactAuthorise')} - authorise npm against CodeArtifact

Usage
  dev codeArtifactAuthorise [role] [options]

Options
  --env <name>  Which configured role to use (when more than one exists)
  --cwd <path>  Run against this package instead of the current directory
  --help        Show this message

When no role is given, uses the role from once.aws.roles in package.json.

Assumes the role, then runs \`aws codeartifact login\` to mint a short-lived
token and write it into the global .npmrc.
`;

export async function runAssumeRole(argv: readonly string[], context: RunContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      env: { type: 'string' },
      verify: { type: 'boolean' },
      export: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help === true) {
    info(ASSUME_ROLE_USAGE);
    return 0;
  }

  const role = positionals[0] ?? resolveRole(readAwsConfig(context.cwd), { env: values.env });

  step(`Assuming ${role}`);
  const credentials = assumeRole(role);

  if (values.verify === true) {
    verifyCredentials(credentials);
  }

  ok(`Assumed ${role}`);

  if (values.export === true) {
    for (const [key, value] of Object.entries(credentials)) {
      info(`export ${key}='${value}'`);
    }
  }

  return 0;
}

export async function runCodeArtifactAuthorise(
  argv: readonly string[],
  context: RunContext,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
      env: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
  });

  if (values.help === true) {
    info(CODE_ARTIFACT_USAGE);
    return 0;
  }

  const role = positionals[0] ?? resolveRole(readAwsConfig(context.cwd), { env: values.env });

  step(`Assuming ${role}`);
  const credentials = assumeRole(role);
  verifyCredentials(credentials);
  ok(`Assumed ${role}`);

  step('Authorising CodeArtifact');
  authoriseCodeArtifact(CODE_ARTIFACT_ACCOUNT, credentials);
  ok('CodeArtifact authorised');

  return 0;
}
