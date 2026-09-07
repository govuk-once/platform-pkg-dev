import { describe, expect, it } from 'vitest';
import { compareVersions, isNewer, isRegistrySpec } from './semver.js';

describe('isNewer', () => {
  it('compares each component numerically, not as text', () => {
    expect(isNewer('0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('1.0.0', '0.99.99')).toBe(true);
    expect(isNewer('0.1.2', '0.1.10')).toBe(false);
  });

  it('treats equal versions as not newer', () => {
    expect(isNewer('1.2.3', '1.2.3')).toBe(false);
  });

  it('sorts a prerelease before the release it leads to', () => {
    expect(isNewer('1.0.0', '1.0.0-rc.1')).toBe(true);
    expect(isNewer('1.0.0-rc.1', '1.0.0')).toBe(false);
  });

  it('refuses to guess at unparseable versions', () => {
    expect(isNewer('latest', '1.0.0')).toBe(false);
    expect(compareVersions('1.0', '1.0.0')).toBeUndefined();
  });
});

describe('isRegistrySpec', () => {
  it('accepts ranges and exact versions', () => {
    expect(isRegistrySpec('^0.1.0')).toBe(true);
    expect(isRegistrySpec('0.1.0')).toBe(true);
  });

  it('never rewrites a local spec', () => {
    // Someone developing platform-pkg-dev itself must not have their link replaced
    // with a published version.
    expect(isRegistrySpec('link:../platform-pkg-dev')).toBe(false);
    expect(isRegistrySpec('file:../platform-pkg-dev')).toBe(false);
    expect(isRegistrySpec('workspace:*')).toBe(false);
    expect(isRegistrySpec('git+https://example.com/x.git')).toBe(false);
  });
});
