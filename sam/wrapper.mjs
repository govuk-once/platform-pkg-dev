/* oxlint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Module = require('module');

const TASK_ROOT = '/var/task';

const cache = new Map();

/** The handler's own package (normally src/), so it bundles against src/package.json, not the CDK root. */
function findPackageDir(absPath) {
  let dir = path.dirname(absPath);
  while (dir.startsWith(TASK_ROOT)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    if (dir === TASK_ROOT) break;
    dir = path.dirname(dir);
  }
  return TASK_ROOT;
}

function readDeclaredDeps(pkgDir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  return new Set(Object.keys(manifest.dependencies ?? {}));
}

/**
 * The Lambda runtime ships the AWS SDK, so an undeclared @aws-sdk import is left to
 * it. A declared one is bundled at the package's pinned version - not every SDK
 * package (dsql-signer, for one) is in the runtime. Imports from inside
 * node_modules always bundle, so a bundled package never mixes in runtime copies.
 */
function awsSdkExternals(declared) {
  return {
    name: 'aws-sdk-externals',
    setup(build) {
      build.onResolve({ filter: /^(@aws-sdk\/|aws-sdk$)/ }, (args) => {
        if (args.importer.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
        const name = args.path.startsWith('@')
          ? args.path.split('/').slice(0, 2).join('/')
          : args.path;
        return declared.has(name) ? undefined : { path: args.path, external: true };
      });
    },
  };
}

function isStale(cached) {
  return cached.inputs.some((file) => {
    try {
      return fs.statSync(file).mtimeMs !== cached.mtimes.get(file);
    } catch {
      return true;
    }
  });
}

async function loadHandler(targetRelPath) {
  const cached = cache.get(targetRelPath);
  if (cached && !isStale(cached)) return cached.exports;

  const absPath = path.join(TASK_ROOT, targetRelPath);
  const pkgDir = findPackageDir(absPath);
  const tsconfig = [pkgDir, TASK_ROOT]
    .map((dir) => path.join(dir, 'tsconfig.json'))
    .find((file) => fs.existsSync(file));

  console.log(`Rebundling ${targetRelPath} (package: ${path.relative(TASK_ROOT, pkgDir) || '.'})`);
  const start = Date.now();

  const esbuild = require('esbuild');
  const result = await esbuild.build({
    entryPoints: [absPath],
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    write: false,
    metafile: true,
    tsconfig,
    logLevel: 'warning',
    absWorkingDir: pkgDir,
    plugins: [awsSdkExternals(readDeclaredDeps(pkgDir))],
  });

  const code = result.outputFiles[0].text;

  const m = new Module(absPath, null);
  m.filename = absPath;
  m.paths = Module._nodeModulePaths(path.dirname(absPath));
  m._compile(code, absPath);

  // Watch every source file in the bundle, not just the entry, so editing a shared
  // module rebundles. node_modules only changes on install, which restarts SAM anyway.
  const inputs = Object.keys(result.metafile.inputs)
    .map((file) => path.resolve(pkgDir, file))
    .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`));
  const mtimes = new Map(inputs.map((file) => [file, fs.statSync(file).mtimeMs]));

  console.log(`Bundled ${targetRelPath} in ${Date.now() - start}ms`);

  cache.set(targetRelPath, { inputs, mtimes, exports: m.exports });
  return m.exports;
}

export async function handler(event, context) {
  const targetRelPath = process.env.TARGET_HANDLER;
  if (!targetRelPath) {
    throw new Error('TARGET_HANDLER env var is not set');
  }

  const mod = await loadHandler(targetRelPath);
  const fn = mod.handler;
  if (typeof fn !== 'function') {
    throw new Error(`${targetRelPath} does not export a handler function`);
  }

  return fn(event, context);
}
