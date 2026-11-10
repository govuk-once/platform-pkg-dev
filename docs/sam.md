# SAM Local Development

Run your CDK Lambda + API Gateway stack locally using SAM CLI and LocalStack.

## Quick Start

```sh
dev sam:start
```

This does everything: synths the CDK app with the SAM Aspect, starts LocalStack
(DynamoDB, S3, KMS), provisions tables, and launches the API on
`http://localhost:3000`.

## Commands

| Command                 | What it does                                            |
| ----------------------- | ------------------------------------------------------- |
| `dev sam:start [entry]` | Synth → LocalStack up → provision resources → start API |
| `dev sam:synth [entry]` | Synthesise only (outputs to `cdk/.aws-sam/`)            |
| `dev sam:stop`          | Tear down LocalStack and clean up Lambda containers     |

## Prerequisites

- Docker running
- SAM CLI installed (`brew install aws-sam-cli` or via `dev hooks install`)

## Example: DynamoDB (dynamo)

The dynamo example scaffolds an API with a DynamoDB-backed items endpoint.

### Endpoints

| Method | Path                 | Description    |
| ------ | -------------------- | -------------- |
| `GET`  | `/dynamo-items`      | List all items |
| `GET`  | `/dynamo-items/{id}` | Get one item   |
| `POST` | `/dynamo-items`      | Create an item |

### Create an item

Include a `secret` to see it encrypted with KMS before it is stored (see
[Encrypted fields](#encrypted-fields-kms)).

```sh
curl -X POST http://localhost:3000/dynamo-items \
  -H 'Content-Type: application/json' \
  -d '{"id": "item-1", "name": "First item", "category": "demo", "secret": "api-key-123"}'
```

Response (201):

```json
{
  "pk": "item-1",
  "id": "item-1",
  "name": "First item",
  "category": "demo",
  "createdAt": "2026-11-05T09:00:00.000Z",
  "secret": {
    "encrypted": "YTgwOTEyMTgtYzFl...",
    "decrypted": "api-key-123"
  }
}
```

### List all items

```sh
curl http://localhost:3000/dynamo-items
```

Response (200): an array of items in the same shape. Items created without a
`secret` have no `secret` field.

### Get a single item

```sh
curl http://localhost:3000/dynamo-items/item-1
```

Response (200): the item, in the same shape as the create response.

### Create several items

```sh
curl -X POST http://localhost:3000/dynamo-items \
  -H 'Content-Type: application/json' \
  -d '{"id": "item-2", "name": "Second item", "secret": "another-key-456"}'

curl -X POST http://localhost:3000/dynamo-items \
  -H 'Content-Type: application/json' \
  -d '{"id": "item-3", "name": "No secret", "status": "active"}'

curl http://localhost:3000/dynamo-items
```

## Encrypted fields (KMS)

The dynamo and DSQL examples each create a KMS key (LocalStack provides KMS
locally). If a POST body includes `secret`, the Lambda encrypts it with that key
and stores only the ciphertext: the `secretCiphertext` attribute in DynamoDB, the
`secret_ciphertext` column in DSQL. The plaintext is never written.

So you can see the stored value really is encrypted, every response from these
examples returns both sides:

```json
"secret": {
  "encrypted": "YTgwOTEyMTgtYzFl...",
  "decrypted": "api-key-123"
}
```

`encrypted` is exactly what is in the database; `decrypted` comes from a KMS
`Decrypt` call made for the response. That is for the demo only. A real API
should not return the decrypted secret.

Without a `secret` in the POST body there is nothing to encrypt, so the stored
ciphertext is empty and the response has no `secret` field.

The item id is bound into the ciphertext (the KMS encryption context), so a
ciphertext copied onto another item will not decrypt.

Locally, each key is reached through the alias `alias/<KeyLogicalId>`, which
`dev sam:start` creates in LocalStack and passes to the Lambda as `KMS_KEY_ID`.
Deployed, `KMS_KEY_ID` is the real key id.

## Example: DSQL (dsql)

The DSQL example runs an Aurora DSQL-backed items API against a local DSQL
emulator. It has the same shape as the dynamo example, including the encrypted
`secret` field, which is stored in its own `secret_ciphertext` column.

| Method | Path               | Description    |
| ------ | ------------------ | -------------- |
| `GET`  | `/dsql-items`      | List all items |
| `GET`  | `/dsql-items/{id}` | Get one item   |
| `POST` | `/dsql-items`      | Create an item |

```sh
curl -X POST http://localhost:3000/dsql-items \
  -H 'Content-Type: application/json' \
  -d '{"id": "item-1", "name": "Demo", "secret": "api-key-123"}'

curl http://localhost:3000/dsql-items/item-1
curl http://localhost:3000/dsql-items
```

Response (200) for the single item:

```json
{
  "id": "item-1",
  "name": "Demo",
  "secret": {
    "encrypted": "NjdhMjExNzQtM2Mx...",
    "decrypted": "api-key-123"
  },
  "createdAt": "2026-11-09T10:41:00.181Z"
}
```

The handler connects as `admin`. Deployed, it uses verified TLS and mints an IAM
auth token per connection with `DsqlSigner`. Locally, `dev sam:start` sets
`DSQL_LOCAL_ENDPOINT` to the emulator, which accepts any token over a plain
connection (its certificate is self-signed, so unverified TLS would add no
protection). The table comes
from the stack's `sam:dsql-schema` metadata, applied to the emulator on start.

## Example: SQS Queue (queue)

The queue example scaffolds an API where a POST sends a message to an SQS queue,
which triggers a consumer Lambda. You can see the consumer processing messages in
the SAM logs.

### Endpoints

| Method | Path        | Description                 |
| ------ | ----------- | --------------------------- |
| `POST` | `/messages` | Send a message to the queue |

### Send a message

```sh
curl -X POST http://localhost:3000/messages \
  -H 'Content-Type: application/json' \
  -d '{"action": "process-order", "orderId": "ORD-001"}'
```

Response (202):

```json
{
  "messageId": "a1b2c3d4-...",
  "status": "queued"
}
```

### Watching the producer

The producer Lambda logs each message to the SAM terminal before sending it to
SQS. Watch for lines like:

```
Sending to queue: {"id":"a1b2c3d4-...","action":"process-order","orderId":"ORD-001","sentAt":"2026-11-05T09:00:00.000Z"}
Message sent: a1b2c3d4-...
```

### Triggering the consumer

`sam local start-api` only serves API Gateway routes — it doesn't auto-poll SQS.
To trigger the consumer Lambda with a test event, use `sam local invoke` in a
separate terminal:

```sh
# From the package root, invoke the consumer with a test SQS event
sam local invoke ConsumerFunction40CB859D \
  -t cdk/.aws-sam/*QueueStack.template.json \
  --docker-network sam-local \
  --region eu-west-2 \
  -e - <<'EOF'
{
  "Records": [
    {
      "messageId": "test-001",
      "body": "{\"action\":\"process-order\",\"orderId\":\"ORD-001\"}",
      "attributes": {},
      "messageAttributes": {},
      "md5OfBody": "",
      "eventSource": "aws:sqs",
      "eventSourceARN": "arn:aws:sqs:eu-west-2:000000000000:queue",
      "awsRegion": "eu-west-2"
    }
  ]
}
EOF
```

You'll see the consumer output:

```
Consumer received 1 message(s)
Processing message: {"action":"process-order","orderId":"ORD-001"}
  messageId: test-001
  body.action: process-order
All messages processed
```

### Full flow: producer → SQS → consumer

Run these in separate terminals to see the complete flow:

**Terminal 1** — start the API:

```sh
dev sam:start
```

**Terminal 2** — send a message via the producer, then invoke the consumer:

```sh
# Send a message (producer sends to LocalStack SQS)
curl -X POST http://localhost:3000/messages \
  -H 'Content-Type: application/json' \
  -d '{"action": "send-email", "to": "user@example.com"}'

# Trigger the consumer manually with a test event
sam local invoke ConsumerFunction40CB859D \
  -t cdk/.aws-sam/*QueueStack.template.json \
  --docker-network sam-local \
  --region eu-west-2 \
  -e - <<'EOF'
{
  "Records": [
    {
      "messageId": "manual-test",
      "body": "{\"action\":\"send-email\",\"to\":\"user@example.com\"}",
      "attributes": {},
      "messageAttributes": {},
      "md5OfBody": "",
      "eventSource": "aws:sqs",
      "eventSourceARN": "arn:aws:sqs:eu-west-2:000000000000:queue",
      "awsRegion": "eu-west-2"
    }
  ]
}
EOF
```

## Both examples together

If you selected both examples during `dev init`, two stacks are created:

- `*DynamoStack` — items CRUD on port 3000
- `*QueueStack` — message queue on port 3000

SAM serves all routes from all stacks on the same port. You can use both
simultaneously:

```sh
# Create an item (dynamo stack)
curl -X POST http://localhost:3000/dynamo-items \
  -H 'Content-Type: application/json' \
  -d '{"id": "item-1", "name": "Hello", "secret": "api-key-123"}'

# Send a message (queue stack)
curl -X POST http://localhost:3000/messages \
  -H 'Content-Type: application/json' \
  -d '{"action": "notify", "target": "item-1"}'

# List items
curl http://localhost:3000/dynamo-items
```

## How it works

`src/` is the Lambda package: it has its own `package.json` (the handlers' runtime
libraries, such as `pg` and the AWS SDK clients) and `tsconfig.json`, and is
listed in `pnpm-workspace.yaml`. Add a handler dependency there, not at the root:

```sh
pnpm --filter ./src add zod
```

1. **CDK Aspect** (`SAMLocalAspect` from `@govuk-connect/dev/sam`) — intercepts
   Lambda functions tagged with `sam:source-entry` metadata and redirects them to
   the esbuild wrapper. Also collects DynamoDB table definitions for local
   provisioning.

2. **esbuild wrapper** (`.sam/wrapper.mjs`) — bundles your TypeScript handler on
   the fly inside the Lambda container. Caches by mtime so only changed files
   rebuild (~600ms first hit, instant on cache).

3. **LocalStack** (Docker) — provides DynamoDB, S3, KMS locally. The Aspect
   injects endpoint env vars so the AWS SDK clients connect to LocalStack
   automatically.

4. **SAM CLI** — runs the Lambda containers and API Gateway locally, routing
   HTTP requests to your handlers.

### Hot reload

Edit your handler source (`src/handler.ts`, `src/producer.ts`, etc.) and hit the
endpoint again — the wrapper detects the file change and rebundles automatically.
No restart needed.

## Troubleshooting

**Port 3000 in use** — stop the previous SAM session with `dev sam:stop` or
`Ctrl+C`, then retry.

**LocalStack not ready** — the init script waits up to 30 seconds. If it times
out, run `dev sam:stop` then `dev sam:start` again.

**esbuild not found** — ensure `esbuild` and `@esbuild/linux-x64` are in your
`devDependencies`. Run `dev sync` to add them.

**Handler not found** — check that the `sam:source-entry` metadata on your Lambda
matches the actual file path relative to the package root (e.g. `src/handler.ts`).
