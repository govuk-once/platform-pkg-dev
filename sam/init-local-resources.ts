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

import type { LocalResourceTable } from './types.js';

const LOCALSTACK_ENDPOINT = process.env['LOCALSTACK_ENDPOINT'] ?? 'http://localhost:4566';
const REGION = 'eu-west-2';
const LOCAL_CREDS = { accessKeyId: 'local', secretAccessKey: 'local' }; // pragma: allowlist secret

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

async function createTable(table: LocalResourceTable) {
  try {
    await ddb.send(
      new CreateTableCommand({
        TableName: table.localName,
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: table.keySchema,
        AttributeDefinitions: table.attributeDefinitions,
      }),
    );
    console.log(`  created table ${table.localName}`);
  } catch (err) {
    if (err instanceof ResourceInUseException) {
      console.log(`  table ${table.localName} already exists`);
      return;
    }
    throw err;
  }
}

interface LocalResourceQueue {
  type: 'sqs-queue';
  localName: string;
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

  const tables = resources.filter((r): r is LocalResourceTable => r.type === 'table');
  const queues = resources.filter((r): r is LocalResourceQueue => r.type === 'sqs-queue');

  console.log('Waiting for LocalStack...');
  await waitFor('LocalStack', () => ddb.send(new ListTablesCommand()));

  if (tables.length > 0) {
    console.log('Provisioning DynamoDB tables...');
    for (const table of tables) await createTable(table);
  }

  if (queues.length > 0) {
    console.log('Provisioning SQS queues...');
    for (const queue of queues) await createQueue(queue);
  }

  console.log('Done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
