import { parseArgs } from 'node:util';
import { assumeRole, authoriseCodeArtifact, verifyCredentials } from '../lib/gds.js';
import { bold, info, ok, step } from '../lib/log.js';
import { CODE_ARTIFACT_ACCOUNT } from '../versions.js';
import type { RunContext } from './run.js';

export const ASSUME_ROLE_USAGE = `${bold('dev assumeRole')} - assume a GDS role and print credentials

Usage
  dev assumeRole <role> [options]

Options
  --verify      Confirm the credentials work (calls sts:GetCallerIdentity)
  --export      Print credentials as export statements for eval
  --cwd <path>  Run against this package instead of the current directory
  --help        Show this message

Assumes the named GDS role via gds-cli and prints the credentials. With
--export the output is suitable for eval:

  eval "$(dev assumeRole connect-development-admin --export)"

Credentials are never written to disk and never placed in a process argument.
`;

export const CODE_ARTIFACT_USAGE = `${bold('dev codeArtifactAuthorise')} - authorise npm against CodeArtifact

Usage
  dev codeArtifactAuthorise --role <role> [options]

Options
  --role <name>  The GDS role to assume before authorising (required)
  --cwd <path>   Run against this package instead of the current directory
  --help         Show this message

Assumes the named role, then runs \`aws codeartifact login\` to mint a
short-lived token and write it into the global .npmrc. After this, pnpm and
npm can pull packages from the private CodeArtifact registry.
`;

export async function runAssumeRole(
  argv: readonly string[],
  _context: RunContext,
): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    options: {
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

  const [role] = positionals;
  if (role === undefined) {
    info(ASSUME_ROLE_USAGE);
    return 1;
  }

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
  _context: RunContext,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      role: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (values.help === true) {
    info(CODE_ARTIFACT_USAGE);
    return 0;
  }

  if (values.role === undefined) {
    info(CODE_ARTIFACT_USAGE);
    return 1;
  }

  step(`Assuming ${values.role}`);
  const credentials = assumeRole(values.role);
  verifyCredentials(credentials);
  ok(`Assumed ${values.role}`);

  step('Authorising CodeArtifact');
  authoriseCodeArtifact(CODE_ARTIFACT_ACCOUNT, credentials);
  ok('CodeArtifact authorised');

  return 0;
}
