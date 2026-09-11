import { MANAGED_FIELDS, MANAGED_PINS } from './pins.js';

export interface ScaffoldAnswers {
  /** npm package name, e.g. `connect-org`. */
  readonly packageName: string;
  /** Owning team, recorded under `once.team`. */
  readonly team: string;
  /** Add the AWS CDK dependency set. */
  readonly cdk: boolean;
  /** Publishable library: dual ESM/CJS build and an exports map. */
  readonly isPackage: boolean;
  /** Workspace root: gets a pnpm-workspace.yaml with the shared settings. */
  readonly isWorkspace: boolean;
  /** Member of a workspace: inherits the root's tooling rather than its own. */
  readonly isMember?: boolean;
}

/** npm's own name rules, narrowed - no scopes, no uppercase, no leading punctuation. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export function validatePackageName(name: string): string | undefined {
  if (name.length > 214) return 'Name must be 214 characters or fewer.';
  if (!NAME_PATTERN.test(name)) {
    return 'Use lowercase letters, digits, dots, hyphens or underscores; must start alphanumeric.';
  }
  return undefined;
}

export function validateTeam(team: string): string | undefined {
  return team.trim() === '' ? 'Team cannot be empty.' : undefined;
}

/**
 * Builds the generated package.json.
 *
 * Deliberately has no `scripts` block: the toolchain is reached through
 * `dev build` / `dev test` / `dev lint`, and scripts get added
 * per package when there is something worth wiring up.
 */
export function buildPackageJson(answers: ScaffoldAnswers, pkgDevSpec: string): string {
  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = { 'platform-pkg-dev': pkgDevSpec };

  // Same list `dev sync` enforces, so a fresh package starts in sync by
  // construction rather than by two places happening to agree.
  for (const pin of MANAGED_PINS) {
    if (pin.group === 'cdk' && !answers.cdk) continue;
    // A workspace member resolves the lint, format and type packages by walking
    // up to the root, so declaring them again would install duplicates.
    if (answers.isMember && pin.scope === 'root') continue;
    const section = pin.section === 'dependencies' ? dependencies : devDependencies;
    section[pin.name] = pin.spec;
  }

  const publishFields = answers.isPackage
    ? {
        main: './dist/cjs/index.js',
        module: './dist/esm/index.js',
        types: './dist/esm/index.d.ts',
        exports: {
          '.': {
            types: './dist/esm/index.d.ts',
            import: './dist/esm/index.js',
            require: './dist/cjs/index.js',
          },
          './package.json': './package.json',
        },
      }
    : {};

  const manifest = {
    name: answers.packageName,
    version: '0.0.0',
    ...(answers.isPackage ? { private: false } : { private: true }),
    type: 'module',
    sideEffects: false,
    ...publishFields,
    files: ['dist'],
    engines: { node: MANAGED_FIELDS.enginesNode },
    packageManager: MANAGED_FIELDS.packageManager,
    ...(Object.keys(dependencies).length > 0 ? { dependencies: sortKeys(dependencies) } : {}),
    devDependencies: sortKeys(devDependencies),
    publishConfig: {
      registry: MANAGED_FIELDS.publishConfig.registry,
    },
    once: { team: answers.team },
  };

  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function sortKeys(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)));
}
