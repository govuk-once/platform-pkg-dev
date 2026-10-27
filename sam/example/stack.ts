import { Stack, type StackProps } from 'aws-cdk-lib';
import { AttributeType, BillingMode, Table } from 'aws-cdk-lib/aws-dynamodb';
import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { LambdaIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import type { Construct } from 'constructs';

export class SAMExampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const table = new Table(this, 'ItemsTable', {
      partitionKey: { name: 'pk', type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    const fn = new Function(this, 'ItemsFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: Code.fromInline('exports.handler = async () => ({})'),
      environment: {
        TABLE_NAME: table.tableName,
      },
    });

    // Tag the Lambda so the SAMLocalAspect knows where the real source is
    fn.node.addMetadata('sam:source-entry', 'sam/example/handler.ts');

    table.grantReadWriteData(fn);

    const api = new RestApi(this, 'ItemsApi');
    const items = api.root.addResource('items');
    const item = items.addResource('{id}');

    const integration = new LambdaIntegration(fn);
    items.addMethod('GET', integration);
    items.addMethod('POST', integration);
    item.addMethod('GET', integration);
  }
}
