#!/usr/bin/env node
import { App, Aspects } from 'aws-cdk-lib';
import { SAMExampleStack } from './stack.ts';

const app = new App();
const _stack = new SAMExampleStack(app, 'SAMExampleStack');

if (process.env['SAM_LOCAL'] === 'true') {
  const { SAMLocalAspect } = await import('../sam-local.aspect.ts');
  Aspects.of(app).add(new SAMLocalAspect(app));
}

app.synth();
