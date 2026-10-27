import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);
const TABLE_NAME = process.env['TABLE_NAME'] ?? '';

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod;
  const id = event.pathParameters?.['id'];

  if (method === 'GET' && !id) {
    const result = await ddb.send(new ScanCommand({ TableName: TABLE_NAME }));
    return { statusCode: 200, body: JSON.stringify(result.Items ?? []) };
  }

  if (method === 'GET' && id) {
    const result = await ddb.send(new GetCommand({ TableName: TABLE_NAME, Key: { pk: id } }));
    if (!result.Item) return { statusCode: 404, body: JSON.stringify({ error: 'Not found' }) };
    return { statusCode: 200, body: JSON.stringify(result.Item) };
  }

  if (method === 'POST') {
    const body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
    const pk = (body['id'] as string) ?? crypto.randomUUID();
    const item = { pk, ...body, createdAt: new Date().toISOString() };
    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    return { statusCode: 201, body: JSON.stringify(item) };
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
}
