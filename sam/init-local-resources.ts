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

import type { LocalResourceTable } from './types.ts';

const LOCALSTACK_ENDPOINT = process.env['LOCALSTACK_ENDPOINT'] ?? 'http://localhost:4566';
const REGION = 'eu-west-2';

const ddb = new DynamoDBClient({
  endpoint: LOCALSTACK_ENDPOINT,
  region: REGION,
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' }, // pragma: allowlist secret
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

async function main() {
  const samDir = path.dirname(fileURLToPath(import.meta.url));
  const manifestPath = path.join(samDir, '.aws-sam', 'local-resources.json');
  if (!fs.existsSync(manifestPath)) {
    console.log('No local-resources.json found — run sam:synth first.');
    return;
  }

  console.log('Waiting for LocalStack...');
  await waitFor('DynamoDB', () => ddb.send(new ListTablesCommand()));

  const lines = fs.readFileSync(manifestPath, 'utf-8').split(/\r?\n/).filter(Boolean);

  console.log('Provisioning DynamoDB tables...');
  for (const line of lines) {
    const resource = JSON.parse(line) as LocalResourceTable;
    if (resource.type === 'table') {
      await createTable(resource);
    }
  }

  console.log('Done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
