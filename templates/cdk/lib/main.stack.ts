import { Stack } from 'aws-cdk-lib';

/**
 * Root stack for {{packageName}}.
 *
 * Add constructs in a constructor, for example:
 *
 *   import { Duration, type StackProps } from 'aws-cdk-lib';
 *   import { Queue } from 'aws-cdk-lib/aws-sqs';
 *   import type { Construct } from 'constructs';
 *
 *   constructor(scope: Construct, id: string, props?: StackProps) {
 *     super(scope, id, props);
 *     new Queue(this, 'Work', { visibilityTimeout: Duration.seconds(300) });
 *   }
 *
 * Import from the service-specific entry points (`aws-cdk-lib/aws-sqs`) rather
 * than the package root - the root pulls in every service.
 */
export class MainStack extends Stack {}
