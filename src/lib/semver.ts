/**
 * Minimal semver comparison, enough to answer "is the registry ahead of us?".
 *
 * Deliberately not a full implementation: platform-pkg-dev only ever compares two
 * concrete released versions, never ranges.
 */
export interface Parsed {
  readonly parts: readonly number[];
  /** Anything after `-`, e.g. `rc.1`. Absent means a final release. */
  readonly prerelease: string | undefined;
}

export function parseVersion(version: string): Parsed | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (match === null) return undefined;

  return {
    parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4],
  };
}

/** Returns a negative number if `a` is older than `b`, 0 if equal. */
export function compareVersions(a: string, b: string): number | undefined {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (left === undefined || right === undefined) return undefined;

  for (let i = 0; i < 3; i += 1) {
    const diff = (left.parts[i] ?? 0) - (right.parts[i] ?? 0);
    if (diff !== 0) return diff;
  }

  // A prerelease sorts before the release it leads to: 1.0.0-rc.1 < 1.0.0.
  if (left.prerelease === right.prerelease) return 0;
  if (left.prerelease === undefined) return 1;
  if (right.prerelease === undefined) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/** True when `candidate` is a strictly newer release than `current`. */
export function isNewer(candidate: string, current: string): boolean {
  const result = compareVersions(candidate, current);
  return result !== undefined && result > 0;
}

/**
 * True when a dependency spec points at the registry rather than at local
 * files. `link:`, `file:` and `workspace:` specs are someone developing
 * platform-pkg-dev itself, and must never be rewritten to a published version.
 */
export function isRegistrySpec(spec: string): boolean {
  // `git+https:` and friends are one scheme, not two - hence the optional suffix.
  return !/^(?:link|file|workspace|github|bitbucket|gitlab|https?|ssh|git(?:\+[a-z]+)?):/.test(
    spec.trim(),
  );
}
