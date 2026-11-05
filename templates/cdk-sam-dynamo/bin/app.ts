#!/usr/bin/env node
import { App, Aspects } from 'aws-cdk-lib';
// The .ts extension is deliberate: cdk.json runs this file through Node's type
// stripping, which resolves specifiers as written and does not rewrite them.
import { MainStack } from '../lib/main.stack.ts';

const app = new App();

const account = process.env['CDK_DEFAULT_ACCOUNT'];
const region = process.env['CDK_DEFAULT_REGION'] ?? 'eu-west-2';

new MainStack(app, '{{stackId}}', {
  env: { ...(account === undefined ? {} : { account }), region },
});

if (process.env['SAM_LOCAL'] === 'true') {
  const { SAMLocalAspect } = await import('@govuk-connect/dev/sam');
  Aspects.of(app).add(new SAMLocalAspect(app));
}
