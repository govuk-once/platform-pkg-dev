import { readFileSync } from 'node:fs';

/**
 * Every version platform-pkg-dev hands out lives in versions.json at the package root,
 * not in this file. Bumping a dependency is a data edit - no TypeScript change,
 * and it stays readable in an installed copy.
 *
 * This module loads that file once and exposes it as typed constants.
 */

interface VersionsFile {
  readonly node: number;
  readonly packageManager: string;
  readonly versions: Readonly<Record<string, string>>;
  readonly tools: Readonly<Record<string, string>>;
  readonly hookRevs: Readonly<Record<string, string>>;
  readonly versionUrl: string | null;
  readonly workspaceSettings: Readonly<Record<string, string | number | boolean>>;
}

/** Resolves to <package root>/versions.json from both src/ and dist/. */
const VERSIONS_PATH = new URL('../versions.json', import.meta.url);

function load(): VersionsFile {
  let parsed: Partial<VersionsFile>;

  try {
    parsed = JSON.parse(readFileSync(VERSIONS_PATH, 'utf8')) as Partial<VersionsFile>;
  } catch (cause) {
    throw new Error(`Could not read platform-pkg-dev versions.json: ${(cause as Error).message}`, {
      cause,
    });
  }

  for (const key of [
    'node',
    'packageManager',
    'versions',
    'tools',
    'hookRevs',
    'workspaceSettings',
  ] as const) {
    if (parsed[key] === undefined) {
      throw new Error(`platform-pkg-dev versions.json is missing the "${key}" field.`);
    }
  }

  return parsed as VersionsFile;
}

const FILE = load();

/**
 * Looks up a pinned version, failing loudly rather than silently emitting
 * `undefined` into a generated package.json.
 */
export function versionOf(name: string): string {
  const spec = FILE.versions[name];
  if (spec === undefined) {
    throw new Error(`platform-pkg-dev versions.json has no entry for "${name}".`);
  }
  return spec;
}

/** Every pinned name, for self-consistency checks. */
export const PINNED_NAMES: readonly string[] = Object.keys(FILE.versions);

/** Node major written to the generated .nvmrc, and the minimum platform-pkg-dev runs on. */
export const NODE_MAJOR = FILE.node;

/** Written to `packageManager` in every generated package.json. */
export const PACKAGE_MANAGER = FILE.packageManager;

/** Written to `publishConfig.registry` in every generated package.json */
export const PUBLISH_CONFIG_REGISTRY =
  'https://registry-prod-904690835784.d.codeartifact.eu-west-2.amazonaws.com/npm/registry-prod-repo';

/**
 * Toolchain owned by platform-pkg-dev itself. These are real `dependencies` of this
 * package, not devDependencies of the generated repo - consumers reach them
 * through the `dev build` / `dev test` / `dev lint` wrappers.
 *
 * oxlint rather than ESLint: it parses TypeScript with its own Rust parser
 * instead of linking against the `typescript` package, so it works against
 * TypeScript 7 - which typescript-eslint refuses to load at all. Its type-aware
 * rules come from oxlint-tsgolint, built on tsgo, whose version tracks the
 * pinned TypeScript.
 */
export const TOOLCHAIN = {
  typescript: versionOf('typescript'),
  vitest: versionOf('vitest'),
  oxlint: versionOf('oxlint'),
  'oxlint-tsgolint': versionOf('oxlint-tsgolint'),
} as const;

/** Added to the generated package.json when the CDK prompt is answered yes. */
export const CDK = {
  dependencies: {
    'aws-cdk-lib': versionOf('aws-cdk-lib'),
    constructs: versionOf('constructs'),
  },
  devDependencies: {
    'aws-cdk': versionOf('aws-cdk'),
  },
} as const;

/** Types package pinned to the Node major above. */
export const TYPES_NODE = versionOf('@types/node');

/**
 * The external executables a developer installs by hand, pinned by exact
 * version and verified by preflight.
 *
 * Deliberately short: pre-commit installs every hook repo into its own isolated
 * environment at the revision pinned in HOOK_REVS, so semgrep, checkov and
 * detect-secrets are never on this list and never need to be on PATH.
 */
export const TOOLS: Readonly<Record<string, string>> = FILE.tools;

/** Every pinned tool name, in the order they appear in versions.json. */
export const TOOL_NAMES: readonly string[] = Object.keys(FILE.tools);

/** Looks up a pinned tool version, failing loudly on a missing entry. */
export function toolVersion(tool: string): string {
  const version = FILE.tools[tool];
  if (version === undefined) {
    throw new Error(`platform-pkg-dev versions.json has no tools entry for "${tool}".`);
  }
  return version;
}

/**
 * Hook repo revisions for the generated .pre-commit-config.yaml.
 *
 * For a pre-commit hook the rev *is* the version: pre-commit builds an isolated
 * environment per repo at this revision. Pinning here is what stops a tool
 * drifting to whatever a developer happens to have installed.
 */
export const HOOK_REVS: Readonly<Record<string, string>> = FILE.hookRevs;

/** Every pinned hook repo name. */
export const HOOK_NAMES: readonly string[] = Object.keys(FILE.hookRevs);

/** Looks up a pinned hook rev, failing loudly on a missing entry. */
export function revOf(repo: string): string {
  const rev = FILE.hookRevs[repo];
  if (rev === undefined) {
    throw new Error(`platform-pkg-dev versions.json has no hookRevs entry for "${repo}".`);
  }
  return rev;
}

/**
 * Where `dev sync` looks for the latest platform-pkg-dev version.
 *
 * A plain-text file rather than the npm registry: platform-pkg-dev is served from
 * wherever start.sh is, which need not be npm. Undefined disables the check.
 */
export const VERSION_URL: string | undefined = FILE.versionUrl ?? undefined;

/**
 * Settings platform-pkg-dev owns inside a package's pnpm-workspace.yaml.
 *
 * pnpm has no `extends` for that file, so these are merged in by `dev sync`
 * rather than inherited. Only these keys are touched - `packages:` globs and
 * anything else a package adds are its own.
 */
export const WORKSPACE_SETTINGS: Readonly<Record<string, string | number | boolean>> =
  FILE.workspaceSettings;
