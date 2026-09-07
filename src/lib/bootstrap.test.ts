import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NODE_MAJOR, PACKAGE_MANAGER } from '../versions.js';
import { isNewer } from './semver.js';

/**
 * start.sh is fetched over the network before platform-pkg-dev exists locally, so it
 * cannot read versions.json at runtime - the values are inlined. These tests
 * are what stop them drifting.
 */
const script = readFileSync(new URL('../../start.sh', import.meta.url), 'utf8');
const own = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/**
 * Reads a pin out of the script. The values are written as
 * `NAME=${NAME:-default}` so they can be overridden for local testing, so this
 * has to pull out the default rather than the whole expression.
 */
const value = (name: string): string | undefined => {
  const raw = new RegExp(`^${name}=(.+)$`, 'm').exec(script)?.[1];
  if (raw === undefined) return undefined;
  return new RegExp(`^\\$\\{${name}:-(.*)\\}$`).exec(raw)?.[1] ?? raw;
};

describe('start.sh', () => {
  it('pins the same package manager as versions.json', () => {
    expect(value('PNPM')).toBe(PACKAGE_MANAGER);
  });

  it('requires the same Node major as versions.json', () => {
    expect(value('NODE_MAJOR')).toBe(String(NODE_MAJOR));
  });

  it('asks for a platform-pkg-dev version compatible with this one', () => {
    const spec = value('PKG_DEV') ?? '';
    expect(spec.startsWith('^')).toBe(true);

    // A caret range already covers later patches, so this must not be pinned to
    // the exact current version - only prevented from asking for one that does
    // not exist yet.
    expect(isNewer(spec.slice(1), own.version), `${spec} asks for a future version`).toBe(false);
  });

  it('fails rather than continuing on a pnpm version mismatch', () => {
    expect(script).toContain('is pinned but');
    expect(script).toContain('corepack prepare');
  });

  it('lets the pins be overridden for local testing', () => {
    for (const name of ['NODE_MAJOR', 'PNPM', 'PKG_DEV']) {
      expect(script, `${name} must be overridable`).toContain(`${name}=\${${name}:-`);
    }
  });

  it('does not clobber an existing package.json', () => {
    expect(script).toContain('already exists, leaving it alone');
  });

  it('will not scatter files into a non-empty directory unattended', () => {
    // Piped from curl there is no argv and often no tty, so the unattended
    // path must refuse rather than guess.
    expect(script).toContain('is not empty, and there is no terminal to ask');
    expect(script).toContain('--dir <folder>');
  });
});

describe('VERSION', () => {
  it('matches the version in package.json', () => {
    // `dev sync` compares the installed version against this file, so a stale
    // one would either miss upgrades or loop trying to apply the same version.
    const file = readFileSync(new URL('../../VERSION', import.meta.url), 'utf8').trim();
    expect(file).toBe(own.version);
  });
});
