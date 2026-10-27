/* oxlint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

const TASK_ROOT = '/var/task';
const TSCONFIG = path.join(TASK_ROOT, 'tsconfig.json');

const cache = new Map();

function loadHandler(targetRelPath) {
  const absPath = path.join(TASK_ROOT, targetRelPath);
  const mtime = fs.statSync(absPath).mtimeMs;

  const cached = cache.get(targetRelPath);
  if (cached && cached.mtime === mtime) {
    return cached.exports;
  }

  console.log(`Rebundling ${targetRelPath}`);
  const start = Date.now();

  const esbuild = require('esbuild');
  const result = esbuild.buildSync({
    entryPoints: [absPath],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['@aws-sdk/*', 'aws-sdk'],
    write: false,
    tsconfig: TSCONFIG,
    logLevel: 'warning',
    absWorkingDir: TASK_ROOT,
  });

  const code = result.outputFiles[0].text;

  const m = new Module(absPath, null);
  m.filename = absPath;
  m.paths = Module._nodeModulePaths(path.dirname(absPath));
  m._compile(code, absPath);

  console.log(`Bundled ${targetRelPath} in ${Date.now() - start}ms`);

  cache.set(targetRelPath, { mtime, exports: m.exports });
  return m.exports;
}

export async function handler(event, context) {
  const targetRelPath = process.env.TARGET_HANDLER;
  if (!targetRelPath) {
    throw new Error('TARGET_HANDLER env var is not set');
  }

  const mod = loadHandler(targetRelPath);
  const fn = mod.handler;
  if (typeof fn !== 'function') {
    throw new Error(`${targetRelPath} does not export a handler function`);
  }

  return fn(event, context);
}
