import { NODE_MAJOR } from '../versions.js';
import { dim, error, ok, warn } from './log.js';
import { inspectTools, type ToolStatus } from './tools.js';
import { which } from './which.js';

export { which };

export interface Requirement {
  readonly bin: string;
  readonly why: string;
  readonly install: string;
}

/**
 * Executables that only have to exist - their versions are not platform-pkg-dev's to
 * pin. The version-pinned tools live in versions.json and are checked
 * separately, by exact version.
 */
export const REQUIREMENTS: readonly Requirement[] = [
  {
    bin: 'git',
    why: 'the Connect git hooks are installed into a git repository',
    install: 'xcode-select --install',
  },
  {
    bin: 'pnpm',
    why: 'the generated package.json pins pnpm as its packageManager',
    install: 'corepack enable pnpm',
  },
];

export interface PreflightResult {
  readonly missing: readonly Requirement[];
  readonly tools: readonly ToolStatus[];
  readonly nodeOk: boolean;
}

export function inspectEnvironment(
  requirements: readonly Requirement[] = REQUIREMENTS,
): PreflightResult {
  const missing = requirements.filter((requirement) => which(requirement.bin) === undefined);
  const major = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);

  return { missing, tools: inspectTools(), nodeOk: major >= NODE_MAJOR };
}

/** True when nothing in the result blocks scaffolding. */
export function isSatisfied(result: PreflightResult): boolean {
  return (
    result.nodeOk &&
    result.missing.length === 0 &&
    result.tools.every((status) => status.state === 'ok')
  );
}

/**
 * Reports the environment check. Returns true when it is safe to continue.
 */
export function reportPreflight(result: PreflightResult): boolean {
  if (!result.nodeOk) {
    error(`Node ${NODE_MAJOR} or newer is required (running ${process.versions.node}).`);
    process.stderr.write(`  ${dim(`nvm install ${NODE_MAJOR} && nvm use ${NODE_MAJOR}`)}\n`);
  }

  if (result.missing.length > 0) {
    error(`Missing required command${result.missing.length === 1 ? '' : 's'} on PATH:`);
    for (const requirement of result.missing) {
      process.stderr.write(`  ${requirement.bin} - ${dim(requirement.why)}\n`);
      process.stderr.write(`    ${dim(requirement.install)}\n`);
    }
  }

  for (const status of result.tools) {
    const { spec } = status;

    switch (status.state) {
      case 'ok':
        ok(`${spec.bin} ${status.found}`);
        break;

      case 'missing':
        error(`${spec.bin} is not on PATH - ${spec.why}`);
        process.stderr.write(`  ${dim(spec.install(spec.expected))}\n`);
        break;

      case 'unreadable':
        warn(
          `Could not read a version from \`${spec.bin} --version\` (expected ${spec.expected}).`,
        );
        break;

      case 'mismatch':
        error(
          `${spec.bin} ${status.found} is installed, but platform-pkg-dev pins ${spec.expected}.`,
        );
        process.stderr.write(`  ${dim(spec.install(spec.expected))}\n`);
        break;
    }
  }

  const satisfied = isSatisfied(result);
  if (satisfied) ok('Environment checks passed');
  return satisfied;
}
