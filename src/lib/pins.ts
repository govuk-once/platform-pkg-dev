import { CDK, NODE_MAJOR, PACKAGE_MANAGER, TYPES_NODE, versionOf } from '../versions.js';

export type PinSection = 'dependencies' | 'devDependencies';

/**
 * `core` pins apply to every Once package. `cdk` pins only apply once a package
 * has opted into CDK - `init` adds them when asked, and `sync` then keeps them
 * current without ever forcing CDK onto a package that does not use it.
 */
export type PinGroup = 'core' | 'cdk';

/**
 * Where a pin belongs.
 *
 * `root` pins serve a whole repository - the lint and format binaries, the Node
 * types - and a workspace member resolves them by walking up. Declaring them
 * per member would install several copies and give them a way to disagree.
 * `any` pins are things a package actually imports, so each one needs its own.
 */
export type PinScope = 'root' | 'any';

export interface ManagedPin {
  readonly name: string;
  /** The exact spec string a package must carry. Compared literally. */
  readonly spec: string;
  readonly section: PinSection;
  readonly group: PinGroup;
  readonly scope: PinScope;
}

/**
 * Every dependency whose version platform-pkg-dev owns.
 *
 * `init` writes these and `sync` enforces them, both from this one list, so the
 * two can never disagree about what a Once package should be pinned to.
 */
export const MANAGED_PINS: readonly ManagedPin[] = [
  {
    name: '@types/node',
    spec: TYPES_NODE,
    section: 'devDependencies',
    group: 'core',
    scope: 'root',
  },
  // The oxc toolchain has to be declared per package, unlike TypeScript and
  // Vitest which reach consumers through the `dev` wrappers.
  //
  // Two reasons, both about resolution from the package rather than from
  // platform-pkg-dev: oxlint looks for its type-aware engine in the linted package's
  // node_modules, and the VS Code extension looks for oxlint and oxfmt in the
  // workspace. Without these the editor silently has no linter and no
  // formatter, which is worse than a loud failure.
  {
    name: 'oxlint',
    spec: versionOf('oxlint'),
    section: 'devDependencies',
    group: 'core',
    scope: 'root',
  },
  {
    name: 'oxlint-tsgolint',
    spec: versionOf('oxlint-tsgolint'),
    section: 'devDependencies',
    group: 'core',
    scope: 'root',
  },
  {
    name: 'oxfmt',
    spec: versionOf('oxfmt'),
    section: 'devDependencies',
    group: 'core',
    scope: 'root',
  },
  // `any` scope, unlike the lint and format binaries: test files import vitest
  // by name, so a package that has tests must resolve it itself. Vitest's own
  // runner resolves the import at runtime, but TypeScript and the editor cannot
  // - which showed up as 13 phantom "Cannot find module 'vitest'" errors.
  {
    name: 'vitest',
    spec: versionOf('vitest'),
    section: 'devDependencies',
    group: 'core',
    scope: 'any',
  },
  {
    name: 'aws-cdk-lib',
    spec: CDK.dependencies['aws-cdk-lib'],
    section: 'dependencies',
    group: 'cdk',
    scope: 'any',
  },
  {
    name: 'constructs',
    spec: CDK.dependencies.constructs,
    section: 'dependencies',
    group: 'cdk',
    scope: 'any',
  },
  {
    name: 'aws-cdk',
    spec: CDK.devDependencies['aws-cdk'],
    section: 'devDependencies',
    group: 'cdk',
    scope: 'any',
  },
];

/** Top-level manifest fields platform-pkg-dev also owns. */
export const MANAGED_FIELDS = {
  packageManager: PACKAGE_MANAGER,
  enginesNode: `>=${NODE_MAJOR}`,
} as const;

export interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
  engines?: { node?: string };
  [key: string]: unknown;
}

export type DriftKind = 'add' | 'update' | 'move';

export interface Drift {
  /** Dependency name, or the manifest field path for field drift. */
  readonly target: string;
  readonly kind: DriftKind;
  readonly from: string | undefined;
  readonly to: string;
  readonly section?: PinSection;
  /** Set when the dependency was found in the wrong section. */
  readonly fromSection?: PinSection;
}

const OTHER: Record<PinSection, PinSection> = {
  dependencies: 'devDependencies',
  devDependencies: 'dependencies',
};

/** Pins that apply to a manifest: core always, cdk only once the package uses it. */
export function applicablePins(
  manifest: Manifest,
  options: { isMember?: boolean } = {},
): readonly ManagedPin[] {
  const usesCdk = MANAGED_PINS.filter((pin) => pin.group === 'cdk').some(
    (pin) =>
      manifest.dependencies?.[pin.name] !== undefined ||
      manifest.devDependencies?.[pin.name] !== undefined,
  );

  return MANAGED_PINS.filter(
    (pin) =>
      (pin.group === 'core' || usesCdk) && !(options.isMember === true && pin.scope === 'root'),
  );
}

/**
 * Compares a manifest against the pins platform-pkg-dev owns.
 *
 * Specs are compared as literal strings: `^2.266.0` is drift from `2.266.0`,
 * which is the point - a range is not a pin.
 */
export function computeDrift(manifest: Manifest, options: { isMember?: boolean } = {}): Drift[] {
  const drift: Drift[] = [];

  for (const pin of applicablePins(manifest, options)) {
    const current = manifest[pin.section]?.[pin.name];
    const misplaced = manifest[OTHER[pin.section]]?.[pin.name];

    if (current === undefined && misplaced !== undefined) {
      drift.push({
        target: pin.name,
        kind: 'move',
        from: misplaced,
        to: pin.spec,
        section: pin.section,
        fromSection: OTHER[pin.section],
      });
      continue;
    }

    if (current === undefined) {
      drift.push({
        target: pin.name,
        kind: 'add',
        from: undefined,
        to: pin.spec,
        section: pin.section,
      });
      continue;
    }

    if (current !== pin.spec) {
      drift.push({
        target: pin.name,
        kind: 'update',
        from: current,
        to: pin.spec,
        section: pin.section,
      });
    }
  }

  if (manifest.packageManager !== MANAGED_FIELDS.packageManager) {
    drift.push({
      target: 'packageManager',
      kind: manifest.packageManager === undefined ? 'add' : 'update',
      from: manifest.packageManager,
      to: MANAGED_FIELDS.packageManager,
    });
  }

  if (manifest.engines?.node !== MANAGED_FIELDS.enginesNode) {
    drift.push({
      target: 'engines.node',
      kind: manifest.engines?.node === undefined ? 'add' : 'update',
      from: manifest.engines?.node,
      to: MANAGED_FIELDS.enginesNode,
    });
  }

  return drift;
}

/**
 * Applies drift in place. Existing keys keep their position in the file, so a
 * sync produces the smallest possible diff.
 */
export function applyDrift(manifest: Manifest, drift: readonly Drift[]): Manifest {
  for (const change of drift) {
    if (change.target === 'packageManager') {
      manifest.packageManager = change.to;
      continue;
    }

    if (change.target === 'engines.node') {
      manifest.engines = { ...manifest.engines, node: change.to };
      continue;
    }

    const section = change.section;
    if (section === undefined) continue;

    if (change.fromSection !== undefined) {
      delete manifest[change.fromSection]?.[change.target];
    }

    manifest[section] = { ...manifest[section], [change.target]: change.to };
  }

  return manifest;
}

/** Human-readable one-liner for a single drift entry. */
export function describeDrift(change: Drift): string {
  const where = change.section === undefined ? '' : ` (${change.section})`;

  switch (change.kind) {
    case 'add':
      return `+ ${change.target}${where} ${change.to}`;
    case 'move':
      return `> ${change.target} ${change.fromSection} -> ${change.section}, ${change.from ?? ''} -> ${change.to}`;
    case 'update':
    default:
      return `~ ${change.target}${where} ${change.from ?? ''} -> ${change.to}`;
  }
}
