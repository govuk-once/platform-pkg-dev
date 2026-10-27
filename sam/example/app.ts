#!/usr/bin/env node
import { App, Aspects } from 'aws-cdk-lib';
import { SAMExampleStack } from './stack.ts';
import { SAMLocalAspect } from '../sam-local.aspect.ts';

const app = new App();
const _stack = new SAMExampleStack(app, 'SAMExampleStack');

if (process.env['SAM_LOCAL'] === 'true') {
  Aspects.of(app).add(new SAMLocalAspect(app));
}

app.synth();
