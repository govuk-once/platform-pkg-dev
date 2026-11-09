import { describe, expect, it } from 'vitest';
import { buildFunctionsPackageJson } from './functions-package.js';
import { functionVersion } from '../versions.js';

type Manifest = {
  name: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const parse = (content: string) => JSON.parse(content) as Manifest;

describe('buildFunctionsPackageJson', () => {
  it('declares each example’s runtime libraries at their pinned versions', () => {
    const manifest = parse(buildFunctionsPackageJson('connect-foo', ['dsql', 'queue']));

    expect(manifest.name).toBe('connect-foo-functions');
    expect(manifest.dependencies).toEqual({
      '@aws-sdk/client-kms': functionVersion('@aws-sdk/client-kms'),
      '@aws-sdk/client-sqs': functionVersion('@aws-sdk/client-sqs'),
      '@aws-sdk/dsql-signer': functionVersion('@aws-sdk/dsql-signer'),
      pg: functionVersion('pg'),
    });
    expect(manifest.devDependencies).toEqual({
      '@types/aws-lambda': functionVersion('@types/aws-lambda'),
      '@types/pg': functionVersion('@types/pg'),
    });
  });

  it('adds a new example’s libraries without touching versions a team already set', () => {
    const existing = JSON.stringify({
      name: 'custom-name',
      dependencies: { pg: '9.0.0', zod: '4.0.0' },
    });

    const manifest = parse(buildFunctionsPackageJson('connect-foo', ['dsql', 'dynamo'], existing));

    expect(manifest.name).toBe('custom-name');
    expect(manifest.dependencies['pg']).toBe('9.0.0');
    expect(manifest.dependencies['zod']).toBe('4.0.0');
    expect(manifest.dependencies['@aws-sdk/client-dynamodb']).toBe(
      functionVersion('@aws-sdk/client-dynamodb'),
    );
  });
});
