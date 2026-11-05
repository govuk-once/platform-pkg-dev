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

| Command         | What it does                                            |
| --------------- | ------------------------------------------------------- |
| `dev sam:start` | Synth → LocalStack up → provision resources → start API |
| `dev sam:synth` | Synthesise only (outputs to `cdk/.aws-sam/`)            |
| `dev sam:stop`  | Tear down LocalStack and clean up Lambda containers     |

## Prerequisites

- Docker running
- SAM CLI installed (`brew install aws-sam-cli` or via `dev hooks install`)

## Example: DynamoDB (dynamo)

The dynamo example scaffolds an API with a DynamoDB-backed items endpoint.

### Endpoints

| Method | Path          | Description        |
| ------ | ------------- | ------------------ |
| `GET`  | `/items`      | List all items     |
| `GET`  | `/items/{id}` | Get one item by id |
| `POST` | `/items`      | Create an item     |

### Create an item

```sh
curl -X POST http://localhost:3000/items \
  -H 'Content-Type: application/json' \
  -d '{"id": "item-1", "name": "First item", "category": "demo"}'
```

Response (201):

```json
{
  "pk": "item-1",
  "id": "item-1",
  "name": "First item",
  "category": "demo",
  "createdAt": "2026-11-05T09:00:00.000Z"
}
```

### List all items

```sh
curl http://localhost:3000/items
```

Response (200):

```json
[
  {
    "pk": "item-1",
    "id": "item-1",
    "name": "First item",
    "category": "demo",
    "createdAt": "2026-11-05T09:00:00.000Z"
  }
]
```

### Get a single item

```sh
curl http://localhost:3000/items/item-1
```

Response (200):

```json
{
  "pk": "item-1",
  "id": "item-1",
  "name": "First item",
  "category": "demo",
  "createdAt": "2026-11-05T09:00:00.000Z"
}
```

### Create several items

```sh
curl -X POST http://localhost:3000/items \
  -H 'Content-Type: application/json' \
  -d '{"id": "item-2", "name": "Second item"}'

curl -X POST http://localhost:3000/items \
  -H 'Content-Type: application/json' \
  -d '{"id": "item-3", "name": "Third item", "status": "active"}'

curl http://localhost:3000/items
```

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
curl -X POST http://localhost:3000/items \
  -H 'Content-Type: application/json' \
  -d '{"id": "item-1", "name": "Hello"}'

# Send a message (queue stack)
curl -X POST http://localhost:3000/messages \
  -H 'Content-Type: application/json' \
  -d '{"action": "notify", "target": "item-1"}'

# List items
curl http://localhost:3000/items
```

## How it works

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
