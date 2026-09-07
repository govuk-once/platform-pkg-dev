import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyDrift, computeDrift, MANAGED_FIELDS, MANAGED_PINS, type Manifest } from './pins.js';
import { PINNED_NAMES, TOOLCHAIN } from '../versions.js';

const inSync = (): Manifest => ({
  name: 'once-org',
  packageManager: MANAGED_FIELDS.packageManager,
  engines: { node: MANAGED_FIELDS.enginesNode },
  devDependencies: Object.fromEntries(
    MANAGED_PINS.filter((pin) => pin.group === 'core' && pin.section === 'devDependencies').map(
      (pin) => [pin.name, pin.spec],
    ),
  ),
});

const pinSpec = (name: string): string => {
  const pin = MANAGED_PINS.find((candidate) => candidate.name === name);
  if (pin === undefined) throw new Error(`no managed pin named ${name}`);
  return pin.spec;
};

describe('computeDrift', () => {
  it('reports nothing for a package that already matches', () => {
    expect(computeDrift(inSync())).toEqual([]);
  });

  it('treats a caret range as drift from an exact pin', () => {
    const manifest = inSync();
    manifest.devDependencies = { ...manifest.devDependencies, '@types/node': '^24.13.3' };

    const drift = computeDrift(manifest);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({
      target: '@types/node',
      kind: 'update',
      from: '^24.13.3',
      to: pinSpec('@types/node'),
    });
  });

  it('adds a missing core pin', () => {
    const manifest = inSync();
    delete manifest.devDependencies?.['@types/node'];

    expect(computeDrift(manifest)).toContainEqual(
      expect.objectContaining({ target: '@types/node', kind: 'add' }),
    );
  });

  it('leaves CDK alone for packages that do not use it', () => {
    const drift = computeDrift(inSync());
    expect(drift.map((change) => change.target)).not.toContain('aws-cdk-lib');
  });

  it('enforces the whole CDK set once a package has opted in', () => {
    const manifest = inSync();
    manifest.dependencies = { 'aws-cdk-lib': '2.100.0' };

    const drift = computeDrift(manifest);
    const targets = drift.map((change) => change.target);

    expect(targets).toContain('aws-cdk-lib');
    expect(targets).toContain('constructs');
    expect(targets).toContain('aws-cdk');
  });

  it('pins constructs exactly, not as a range', () => {
    expect(pinSpec('constructs')).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('flags a dependency sitting in the wrong section', () => {
    const manifest = inSync();
    delete manifest.devDependencies?.['@types/node'];
    manifest.dependencies = { '@types/node': pinSpec('@types/node') };

    expect(computeDrift(manifest)).toContainEqual(
      expect.objectContaining({
        target: '@types/node',
        kind: 'move',
        fromSection: 'dependencies',
        section: 'devDependencies',
      }),
    );
  });

  it('reports drifted packageManager and engines.node', () => {
    const manifest = inSync();
    manifest.packageManager = 'pnpm@9.0.0';
    manifest.engines = { node: '>=20' };

    const targets = computeDrift(manifest).map((change) => change.target);
    expect(targets).toContain('packageManager');
    expect(targets).toContain('engines.node');
  });
});

describe('applyDrift', () => {
  it('makes a drifted manifest clean, and is idempotent', () => {
    const manifest: Manifest = { name: 'once-org', devDependencies: { '@types/node': '^1.0.0' } };

    applyDrift(manifest, computeDrift(manifest));
    expect(computeDrift(manifest)).toEqual([]);

    applyDrift(manifest, computeDrift(manifest));
    expect(computeDrift(manifest)).toEqual([]);
  });

  it('moves a misplaced dependency instead of duplicating it', () => {
    const manifest: Manifest = {
      name: 'once-org',
      dependencies: { '@types/node': '1.0.0' },
    };

    applyDrift(manifest, computeDrift(manifest));

    expect(manifest.dependencies?.['@types/node']).toBeUndefined();
    expect(manifest.devDependencies?.['@types/node']).toBe(pinSpec('@types/node'));
  });

  it('leaves unmanaged dependencies untouched', () => {
    const manifest: Manifest = {
      name: 'once-org',
      dependencies: { 'some-lib': '^1.2.3' },
      devDependencies: { '@types/node': '^1.0.0' },
    };

    applyDrift(manifest, computeDrift(manifest));
    expect(manifest.dependencies?.['some-lib']).toBe('^1.2.3');
  });
});

describe('versions.json', () => {
  it('backs every managed pin', () => {
    for (const pin of MANAGED_PINS) {
      expect(PINNED_NAMES, `${pin.name} must be listed in versions.json`).toContain(pin.name);
    }
  });

  it('matches the toolchain platform-pkg-dev actually installs', () => {
    const own = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { dependencies: Record<string, string> };

    for (const [name, spec] of Object.entries(TOOLCHAIN)) {
      expect(own.dependencies[name], `platform-pkg-dev must depend on ${name}@${spec}`).toBe(spec);
    }
  });
});

describe('workspace members', () => {
  it('is not told to declare the tooling the root already provides', () => {
    const manifest: Manifest = { name: 'member' };
    const targets = computeDrift(manifest, { isMember: true }).map((change) => change.target);

    // pnpm resolves these by walking up, so a member declaring them would
    // install duplicates and give the two copies a way to disagree.
    expect(targets).not.toContain('oxlint');
    expect(targets).not.toContain('oxfmt');
    expect(targets).not.toContain('oxlint-tsgolint');
    expect(targets).not.toContain('@types/node');
  });

  it('is still held to the CDK pins, which it imports directly', () => {
    const manifest: Manifest = { name: 'member', dependencies: { 'aws-cdk-lib': '2.0.0' } };
    const targets = computeDrift(manifest, { isMember: true }).map((change) => change.target);

    expect(targets).toContain('aws-cdk-lib');
    expect(targets).toContain('constructs');
  });

  it('still expects the full set in a standalone package', () => {
    const targets = computeDrift({ name: 'solo' }).map((change) => change.target);

    expect(targets).toContain('oxlint');
    expect(targets).toContain('@types/node');
  });
});
