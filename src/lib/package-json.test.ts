import { describe, expect, it } from 'vitest';
import { buildPackageJson, validatePackageName, validateTeam } from './package-json.js';
import { CDK, NODE_MAJOR, PACKAGE_MANAGER, PUBLISH_CONFIG_REGISTRY } from '../versions.js';

const base = {
  packageName: 'connect-org',
  team: 'identity',
  cdk: false,
  isPackage: false,
  isWorkspace: false,
} as const;

const parse = (answers: Parameters<typeof buildPackageJson>[0]) =>
  JSON.parse(buildPackageJson(answers, '0.0.1')) as Record<string, unknown>;

describe('validatePackageName', () => {
  it('accepts conventional Connect names', () => {
    expect(validatePackageName('connect-org')).toBeUndefined();
    expect(validatePackageName('connect-security')).toBeUndefined();
  });

  it('rejects uppercase, scopes and leading punctuation', () => {
    expect(validatePackageName('ConnectOrg')).toBeDefined();
    expect(validatePackageName('@once/org')).toBeDefined();
    expect(validatePackageName('-once')).toBeDefined();
  });
});

describe('validateTeam', () => {
  it('rejects blank teams', () => {
    expect(validateTeam('  ')).toBeDefined();
    expect(validateTeam('identity')).toBeUndefined();
  });
});

describe('buildPackageJson', () => {
  it('emits the fixed platform fields', () => {
    const manifest = parse(base);

    expect(manifest['name']).toBe('connect-org');
    expect(manifest['type']).toBe('module');
    expect(manifest['sideEffects']).toBe(false);
    expect(manifest['files']).toEqual(['dist']);
    expect(manifest['engines']).toEqual({ node: `>=${NODE_MAJOR}` });
    expect(manifest['packageManager']).toBe(PACKAGE_MANAGER);
    expect(manifest['publishConfig']).toStrictEqual({ registry: PUBLISH_CONFIG_REGISTRY });
    expect(manifest['once']).toEqual({ team: 'identity' });
    expect(manifest).toStrictEqual({
      name: 'connect-org',
      version: '0.0.0',
      private: true,
      type: 'module',
      sideEffects: false,
      files: ['dist'],
      engines: { node: `>=${NODE_MAJOR}` },
      packageManager: PACKAGE_MANAGER,
      devDependencies: {
        '@types/node': '24.13.3',
        oxfmt: '0.63.0',
        oxlint: '1.78.0',
        'oxlint-tsgolint': '7.0.2001',
        'platform-pkg-dev': '0.0.1',
        vitest: '4.1.10',
      },
      publishConfig: {
        registry: PUBLISH_CONFIG_REGISTRY,
      },
      once: { team: 'identity' },
    });
  });

  it('has no scripts block', () => {
    expect(parse(base)['scripts']).toBeUndefined();
  });

  it('depends on platform-pkg-dev at the requested spec', () => {
    const devDeps = parse(base)['devDependencies'] as Record<string, string>;
    expect(devDeps['platform-pkg-dev']).toBe('0.0.1');

    const linked = JSON.parse(buildPackageJson(base, 'link:../platform-pkg-dev')) as {
      devDependencies: Record<string, string>;
    };
    expect(linked.devDependencies['platform-pkg-dev']).toBe('link:../platform-pkg-dev');
  });

  it('marks non-library packages private and omits an exports map', () => {
    const manifest = parse(base);
    expect(manifest['private']).toBe(true);
    expect(manifest['exports']).toBeUndefined();
  });

  it('gives libraries a dual ESM/CJS exports map', () => {
    const manifest = parse({ ...base, isPackage: true });

    expect(manifest['private']).toBe(false);
    expect(manifest['exports']).toEqual({
      '.': {
        types: './dist/esm/index.d.ts',
        import: './dist/esm/index.js',
        require: './dist/cjs/index.js',
      },
      './package.json': './package.json',
    });
  });

  it('adds the CDK dependency set only when asked', () => {
    expect(parse(base)['dependencies']).toBeUndefined();

    const withCdk = parse({ ...base, cdk: true });
    const deps = withCdk['dependencies'] as Record<string, string>;
    const devDeps = withCdk['devDependencies'] as Record<string, string>;

    expect(deps['aws-cdk-lib']).toBe(CDK.dependencies['aws-cdk-lib']);
    expect(deps['constructs']).toBe(CDK.dependencies.constructs);
    expect(devDeps['aws-cdk']).toBe(CDK.devDependencies['aws-cdk']);
  });
});
