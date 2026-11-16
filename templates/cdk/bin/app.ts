#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { MainStack } from '../lib/main.stack.js';

const app = new App();

// Spread rather than assign: the base tsconfig sets exactOptionalPropertyTypes,
// so an explicit `account: undefined` is not assignable to Environment. Leaving
// account unset makes the stack environment-agnostic, which is what you want
// until it needs an account-specific lookup.
const account = process.env['CDK_DEFAULT_ACCOUNT'];
const region = process.env['CDK_DEFAULT_REGION'] ?? 'eu-west-2';

new MainStack(app, '{{stackId}}', {
  env: { ...(account === undefined ? {} : { account }), region },
});
