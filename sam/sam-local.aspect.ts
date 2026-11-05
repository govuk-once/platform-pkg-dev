import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import type { IConstruct } from 'constructs';
import { Construct } from 'constructs';
import { type IAspect, type App, AssetHashType, DockerImage, Stack } from 'aws-cdk-lib';
import { Code, Function as LambdaFunction, type CfnFunction } from 'aws-cdk-lib/aws-lambda';
import type { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { type CfnTable, Table } from 'aws-cdk-lib/aws-dynamodb';
import { type CfnQueue, Queue } from 'aws-cdk-lib/aws-sqs';

import type { LocalResourceTable, SharedAssetCachedS3, LocalResourceSharedEnv } from './types.js';

const WRAPPER_SCOPE_ID = 'SAMWrapperCode';
const __compiledDir = path.dirname(fileURLToPath(import.meta.url));
const __samDir = path.resolve(__compiledDir, '../../sam');

const ASSET_EXCLUDES = [
  '.git',
  '.github',
  '.nx',
  'build',
  'dist',
  'coverage',
  'cdk.out',
  '.aws-sam',
  'sam/.aws-sam',
  'e2e',
  'performance',
  'docs',
  '**/*.test.ts',
  '**/*.unit.test.ts',
  'sam/tests',
];

export class SAMLocalAspect implements IAspect {
  private sharedEnv: LocalResourceSharedEnv;
  private sharedCode!: Code;
  private manifestOut: string;
  private sharedAssetCachedS3?: SharedAssetCachedS3;
  private assetPath?: string;
  private collectedTables: LocalResourceTable[] = [];
  private collectedQueues: Map<string, string> = new Map();
  private repoRoot: string;
  private wrapperHandler: string;

  constructor(app: App, props: { sharedEnv?: LocalResourceSharedEnv; repoRoot?: string } = {}) {
    this.sharedEnv = props.sharedEnv ?? {};
    this.repoRoot = props.repoRoot ?? process.env['SAM_REPO_ROOT'] ?? process.cwd();
    this.manifestOut = path.join(app.assetOutdir, 'local-resources.json');
    this.wrapperHandler = this.ensureShortWrapperPath();
    this.createSharedCode();

    app.node.addValidation({
      validate: () => {
        this.writeManifest();
        this.rewriteQueueUrls(app);
        return [];
      },
    });
  }

  visit(node: IConstruct): void {
    if (process.env['SAM_LOCAL'] !== 'true') return;

    if (node instanceof LambdaFunction) {
      this.wrapLambda(node);
    }

    if (node instanceof Table) {
      this.collectTable(node);
    }

    if (node instanceof Queue) {
      this.collectQueue(node);
    }
  }

  private ensureShortWrapperPath(): string {
    const wrapperSrc = path.join(__samDir, 'wrapper.mjs');
    const shortDir = path.join(this.repoRoot, '.sam');
    const shortPath = path.join(shortDir, 'wrapper.mjs');

    fs.mkdirSync(shortDir, { recursive: true });
    fs.copyFileSync(wrapperSrc, shortPath);

    return '.sam/wrapper.handler';
  }

  private writeManifest(): void {
    const resources: unknown[] = [
      ...this.collectedTables,
      ...[...this.collectedQueues.entries()].map(([, url]) => ({
        type: 'sqs-queue' as const,
        // oxlint-disable-next-line typescript/no-non-null-assertion
        localName: url.split('/').pop()!,
      })),
    ];
    if (resources.length === 0) return;
    const lines = resources.map((r) => JSON.stringify(r));
    fs.writeFileSync(this.manifestOut, lines.join('\n'));
  }

  private createSharedCode() {
    if (!this.sharedCode) {
      const root = this.repoRoot;
      this.sharedCode = Code.fromAsset(root, {
        exclude: ASSET_EXCLUDES,
        assetHash: 'sam-local-dev-v1',
        assetHashType: AssetHashType.CUSTOM,
        bundling: {
          image: DockerImage.fromRegistry('busybox'),
          local: {
            tryBundle(outputDir: string): boolean {
              fs.rmSync(outputDir, { recursive: true, force: true });
              fs.symlinkSync(root, outputDir, 'dir');
              return true;
            },
          },
        },
      });
    }
  }

  private collectTable(node: Table) {
    const cfn = node.node.defaultChild as CfnTable;
    const stack = Stack.of(cfn);
    const keySchema = (cfn.keySchema as { attributeName: string; keyType: string }[]).map((k) => ({
      AttributeName: k.attributeName,
      KeyType: k.keyType as 'HASH' | 'RANGE',
    }));
    const attributeDefinitions = (
      cfn.attributeDefinitions as { attributeName: string; attributeType: string }[]
    ).map((k) => ({
      AttributeName: k.attributeName,
      AttributeType: k.attributeType as 'S' | 'N' | 'B',
    }));
    const ttlSpec = cfn.timeToLiveSpecification as
      | { enabled?: boolean; attributeName?: string }
      | undefined;
    const localName = stack.getLogicalId(cfn);
    const ttlAttribute = ttlSpec?.enabled ? ttlSpec.attributeName : undefined;
    const table: LocalResourceTable = {
      type: 'table',
      localName,
      keySchema,
      attributeDefinitions,
      ...(ttlAttribute !== undefined ? { ttlAttribute } : {}),
    };

    this.collectedTables.push(table);
    cfn.addPropertyOverride('TableName', localName);
  }

  private rewriteQueueUrls(_app: App): void {
    // Queue URL rewriting is handled post-synth in the template merge step,
    // because CDK tokens are opaque during synthesis and SAM resolves
    // {Ref: QueueLogicalId} to just the logical ID (not a URL).
  }

  private collectQueue(node: Queue) {
    const cfn = node.node.defaultChild as CfnQueue;
    const stack = Stack.of(cfn);
    const localName = stack.getLogicalId(cfn);
    cfn.addPropertyOverride('QueueName', localName);
    this.collectedQueues.set(node.queueUrl, `http://localstack:4566/000000000000/${localName}`);
  }

  private wrapLambda(node: LambdaFunction) {
    const samSourceEntry = node.node.metadata.find((m) => m.type === 'sam:source-entry')?.data;

    if (!samSourceEntry) return;

    const cfn = node.node.defaultChild as CfnFunction;
    const s3 = this.getSharedS3(Stack.of(node));
    const assetPath = this.getWrapperAssetPath(Stack.of(node));
    const env: Record<string, string> = {
      ...this.sharedEnv,
      TARGET_HANDLER: samSourceEntry as string,
      AWS_ENDPOINT_URL_DYNAMODB: 'http://localstack:4566',
      AWS_ENDPOINT_URL_SQS: 'http://localstack:4566',
      AWS_ENDPOINT_URL_S3: 'http://localstack:4566',
      AWS_ENDPOINT_URL_KMS: 'http://localstack:4566',
    };

    cfn.addPropertyOverride('Handler', this.wrapperHandler);
    cfn.addPropertyOverride('Code', {
      S3Bucket: s3.bucketName,
      S3Key: s3.objectKey,
    });
    for (const [key, value] of Object.entries(env)) {
      cfn.addPropertyOverride(`Environment.Variables.${key}`, value);
    }
    cfn.cfnOptions.metadata = {
      ...cfn.cfnOptions.metadata,
      'aws:asset:path': assetPath,
      'aws:asset:property': 'Code',
    };
  }

  private getWrapperAssetPath(stack: Stack) {
    if (this.assetPath) return this.assetPath;

    const scope =
      stack.node.tryFindChild(WRAPPER_SCOPE_ID) ?? new Construct(stack, WRAPPER_SCOPE_ID);

    const asset = scope.node.tryFindChild('Code') as Asset | undefined;
    if (!asset) throw new Error('Missing Code asset');

    this.assetPath = `asset.${asset.assetHash}`;
    return this.assetPath;
  }

  private getSharedS3(stack: Stack) {
    if (this.sharedAssetCachedS3) return this.sharedAssetCachedS3;

    const scope =
      stack.node.tryFindChild(WRAPPER_SCOPE_ID) ?? new Construct(stack, WRAPPER_SCOPE_ID);

    const bound = this.sharedCode.bind(scope);
    if (!bound.s3Location) throw new Error('S3 location does not exist in bound code');

    this.sharedAssetCachedS3 = bound.s3Location;
    return this.sharedAssetCachedS3;
  }
}
