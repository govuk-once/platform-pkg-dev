/* oxlint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CreateTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  ListTablesCommand,
} from '@aws-sdk/client-dynamodb';
import { SQSClient, CreateQueueCommand, QueueNameExists } from '@aws-sdk/client-sqs';
import {
  CreateAliasCommand,
  CreateKeyCommand,
  DescribeKeyCommand,
  KMSClient,
  NotFoundException,
} from '@aws-sdk/client-kms';
import { Client } from 'pg';

import type { LocalResourceTable } from './types.js';

const LOCALSTACK_ENDPOINT = process.env['LOCALSTACK_ENDPOINT'] ?? 'http://localhost:4566';
const DSQL_HOST = process.env['DSQL_LOCAL_HOST'] ?? 'localhost';
const REGION = 'eu-west-2';
const LOCAL_CREDS = { accessKeyId: 'local', secretAccessKey: 'local' }; // pragma: allowlist secret

// Persistent SDK clients for LocalStack services
const ddb = new DynamoDBClient({
  endpoint: LOCALSTACK_ENDPOINT,
  region: REGION,
  credentials: LOCAL_CREDS,
});

const sqs = new SQSClient({
  endpoint: LOCALSTACK_ENDPOINT,
  region: REGION,
  credentials: LOCAL_CREDS,
});

// Same shape as a real DSQL connection (admin, a token, TLS); the emulator accepts any token.
function createDsqlClient() {
  return new Client({
    host: DSQL_HOST,
    port: 5432,
    database: 'postgres',
    user: 'admin',
    password: 'local', // pragma: allowlist secret
    ssl: { rejectUnauthorized: false },
  });
}

async function waitFor(
  name: string,
  fn: () => Promise<unknown>,
  { timeoutMs = 30_000, intervalMs = 500 } = {},
): Promise<void> {
  const start = Date.now();
  let lastErr: unknown;

  while (Date.now() - start < timeoutMs) {
    try {
      await fn();
      console.log(`  ${name} ready`);
      return;
    } catch (error) {
      lastErr = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw new Error(`${name} not ready after ${timeoutMs}ms: ${JSON.stringify(lastErr)}`);
}

async function createDynamoTable(table: LocalResourceTable) {
  try {
    await ddb.send(
      new CreateTableCommand({
        TableName: table.localName,
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: table.keySchema,
        AttributeDefinitions: table.attributeDefinitions,
      }),
    );
    console.log(`  created DynamoDB table ${table.localName}`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      console.log(`  DynamoDB table ${table.localName} already exists`);
      return;
    }
    throw err;
  }
}

const kms = new KMSClient({
  endpoint: LOCALSTACK_ENDPOINT,
  region: REGION,
  credentials: LOCAL_CREDS,
});

interface LocalResourceKey {
  type: 'kms-key';
  localName: string;
}

/** LocalStack picks its own key ids, so each key is reached through a stable alias. */
async function createKey(key: LocalResourceKey) {
  const alias = `alias/${key.localName}`;
  try {
    await kms.send(new DescribeKeyCommand({ KeyId: alias }));
    console.log(`  KMS key ${alias} already exists`);
    return;
  } catch (err) {
    if (!(err instanceof NotFoundException)) throw err;
  }

  const { KeyMetadata } = await kms.send(new CreateKeyCommand({ Description: key.localName }));
  await kms.send(new CreateAliasCommand({ AliasName: alias, TargetKeyId: KeyMetadata?.KeyId }));
  console.log(`  created KMS key ${alias}`);
}

interface LocalResourceQueue {
  type: 'sqs-queue';
  localName: string;
}

interface LocalResourceDsqlTable {
  type: 'dsql-table';
  localName: string;
  schemaSql: string;
}

async function createQueue(queue: LocalResourceQueue) {
  try {
    await sqs.send(new CreateQueueCommand({ QueueName: queue.localName }));
    console.log(`  created queue ${queue.localName}`);
  } catch (err) {
    if (err instanceof QueueNameExists) {
      console.log(`  queue ${queue.localName} already exists`);
      return;
    }
    throw err;
  }
}

async function createDsqlTable(table: LocalResourceDsqlTable) {
  const dsql = createDsqlClient();
  try {
    await dsql.connect();
    await dsql.query(table.schemaSql);
    console.log(`  applied DSQL schema for ${table.localName}`);
  } catch (err: unknown) {
    const error = err as { code?: string; message?: string };
    // PostgreSQL error code 42P07: duplicate_table
    if (error.code === '42P07' || error.message?.includes('already exists')) {
      console.log(`  DSQL schema for ${table.localName} already applied`);
      return;
    }
    throw err;
  } finally {
    await dsql.end();
  }
}

async function main() {
  const samOutDir =
    process.env['SAM_OUT_DIR'] ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), '.aws-sam');
  const manifestPath = path.join(samOutDir, 'local-resources.json');
  if (!fs.existsSync(manifestPath)) {
    console.log('No local-resources.json found — run dev sam:synth first.');
    return;
  }

  const lines = fs.readFileSync(manifestPath, 'utf-8').split(/\r?\n/).filter(Boolean);
  const resources = lines.map((line) => JSON.parse(line) as { type: string });

  const dynamoTables = resources.filter((r): r is LocalResourceTable => r.type === 'table');
  const queues = resources.filter((r): r is LocalResourceQueue => r.type === 'sqs-queue');
  const keys = resources.filter((r): r is LocalResourceKey => r.type === 'kms-key');
  const dsqlTables = resources.filter((r): r is LocalResourceDsqlTable => r.type === 'dsql-table');

  console.log('Waiting for LocalStack...');
  await waitFor('LocalStack', () => ddb.send(new ListTablesCommand()));

  if (dsqlTables.length > 0) {
    console.log('Waiting for DSQL Emulator...');
    await waitFor('DSQL Emulator', async () => {
      const client = createDsqlClient();
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
    });
  }

  if (dynamoTables.length > 0) {
    console.log('Provisioning DynamoDB tables...');
    for (const table of dynamoTables) await createDynamoTable(table);
  }

  if (keys.length > 0) {
    console.log('Provisioning KMS keys...');
    for (const key of keys) await createKey(key);
  }

  if (queues.length > 0) {
    console.log('Provisioning SQS queues...');
    for (const queue of queues) await createQueue(queue);
  }

  if (dsqlTables.length > 0) {
    console.log('Provisioning DSQL tables...');
    for (const table of dsqlTables) await createDsqlTable(table);
  }

  console.log('Done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
