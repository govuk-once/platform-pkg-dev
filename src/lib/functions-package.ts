import { functionVersion } from '../versions.js';

export type SamExample = 'dsql' | 'dynamo' | 'queue';

export const SAM_EXAMPLES: readonly SamExample[] = ['dsql', 'dynamo', 'queue'];

/** The Lambda package: its own package.json and tsconfig, so handler deps never ride on the CDK root. */
export const FUNCTIONS_DIR = 'src';

const EXAMPLE_DEPS: Readonly<
  Record<SamExample, { dependencies: readonly string[]; devDependencies: readonly string[] }>
> = {
  dsql: {
    dependencies: ['@aws-sdk/client-kms', '@aws-sdk/dsql-signer', 'pg'],
    devDependencies: ['@types/pg'],
  },
  dynamo: {
    dependencies: ['@aws-sdk/client-dynamodb', '@aws-sdk/client-kms', '@aws-sdk/lib-dynamodb'],
    devDependencies: [],
  },
  queue: { dependencies: ['@aws-sdk/client-sqs'], devDependencies: [] },
};

interface FunctionsManifest {
  name?: string;
  private?: boolean;
  type?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

function sorted(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).toSorted(([a], [b]) => a.localeCompare(b)));
}

/**
 * Builds src/package.json for the chosen examples, merging into an existing one.
 *
 * Versions already present are left alone: once a team bumps a handler dependency
 * it is theirs, and re-running `cdk:init --sam` to add an example must not undo it.
 */
export function buildFunctionsPackageJson(
  packageName: string,
  examples: readonly SamExample[],
  existing?: string,
): string {
  const manifest: FunctionsManifest =
    existing === undefined
      ? { name: `${packageName}-functions`, private: true, type: 'module' }
      : (JSON.parse(existing) as FunctionsManifest);

  const dependencies = { ...manifest.dependencies };
  const devDependencies = { ...manifest.devDependencies };

  devDependencies['@types/aws-lambda'] ??= functionVersion('@types/aws-lambda');
  for (const example of examples) {
    for (const name of EXAMPLE_DEPS[example].dependencies) {
      dependencies[name] ??= functionVersion(name);
    }
    for (const name of EXAMPLE_DEPS[example].devDependencies) {
      devDependencies[name] ??= functionVersion(name);
    }
  }

  return `${JSON.stringify(
    { ...manifest, dependencies: sorted(dependencies), devDependencies: sorted(devDependencies) },
    null,
    2,
  )}\n`;
}
