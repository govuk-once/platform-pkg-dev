import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { bold, fail, info, ok, step, warn } from '../lib/log.js';
import { binPath } from '../lib/toolchain.js';
import { renderTemplateDir } from '../lib/render.js';
import type { RunContext } from './run.js';

export const CDK_USAGE = `${bold('dev cdk:init')} - scaffold the CDK app for this package

Usage
  dev cdk:init [options]

Options
  --dir <name>  Directory to create, relative to the package (default: cdk)
  --force       Replace an existing CDK directory
  --cwd <path>  Run against this package instead of the current directory
  --help        Show this message

Runs \`cdk init\` and then layers platform-pkg-dev's own files over the result.

The generated cdk.json is the reason for running cdk init at all: it carries
around ninety context feature flags that must match the CDK version, and
hand-maintaining that list in a template would rot with every upgrade.

Everything cdk init produces that platform-pkg-dev already owns is then removed - its
package.json, tsconfig, Jest config, .gitignore - and bin/app.ts,
lib/main-stack.ts and tsconfig.json are written from platform-pkg-dev's templates.

Separate from \`dev init\` because it needs the CDK CLI, which is not installed
until after the package's first \`pnpm install\`.
`;

/**
 * Files `cdk init` writes that platform-pkg-dev already governs.
 *
 * Each one would otherwise conflict: its package.json makes the directory a
 * second npm package with unpinned CDK dependencies, its Jest config competes
 * with Vitest, and its .gitignore duplicates entries the package root already
 * has.
 */
const SUPERSEDED = [
  'package.json',
  'jest.config.js',
  '.npmignore',
  '.gitignore',
  'README.md',
  'tsconfig.json',
];

export async function runCdkInit(argv: readonly string[], context: RunContext): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      dir: { type: 'string' },
      force: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (values.help === true) {
    info(CDK_USAGE);
    return 0;
  }

  const name = values.dir ?? 'cdk';
  const target = join(context.cwd, name);

  if (existsSync(target)) {
    const entries = await readdir(target);
    if (entries.length > 0 && values.force !== true) {
      fail(`${name}/ already exists and is not empty.`, 'Pass --force to replace it.');
    }
    if (values.force === true) {
      warn(`Replacing ${name}/`);
      await rm(target, { recursive: true, force: true });
    }
  }

  await mkdir(target, { recursive: true });

  // cdk init refuses to run anywhere but an empty directory, which is why this
  // creates a subdirectory rather than scaffolding into the package root.
  step(`cdk init in ${name}/`);
  const cdk = resolveCdk(context.cwd);
  const result = spawnSync(cdk, ['init', 'app', '--language', 'typescript', '--generate-only'], {
    stdio: ['ignore', 'ignore', 'inherit'],
    cwd: target,
  });

  if (result.error !== undefined) fail(`Failed to run cdk: ${result.error.message}`);
  if ((result.status ?? 1) !== 0) return result.status ?? 1;

  const flags = await pruneAndReport(target);
  ok(`cdk.json kept, with ${flags} context feature flags`);

  // Layered on top of cdk init's output, deliberately: the structure and the
  // feature flags are its job, the stack and the compiler settings are ours.
  const written = await renderTemplateDir(
    'cdk',
    target,
    { packageName: packageName(context.cwd), stackId: stackId(context.cwd) },
    { force: true },
  );
  for (const file of written.written.toSorted()) ok(join(name, file));

  await pointAppAtTypeStripping(target);
  ok(`${join(name, 'cdk.json')} app -> node bin/app.ts`);

  info('');
  info(bold('Next steps'));
  info(`  cd ${name} && pnpm exec cdk synth`);

  return 0;
}

/** The CDK CLI from the package's own node_modules, not whatever is on PATH. */
function resolveCdk(cwd: string): string {
  const local = join(cwd, 'node_modules', '.bin', 'cdk');
  if (existsSync(local)) return local;

  try {
    return binPath('aws-cdk', 'cdk');
  } catch {
    // Fall through to the message below, which is more useful than the
    // resolution error binPath would otherwise surface.
  }

  return fail(
    'The CDK CLI is not installed for this package.',
    'Run `pnpm install` first - aws-cdk is a devDependency added by `dev init --cdk`.',
  );
}

/** Removes what platform-pkg-dev owns, and reports how many feature flags survived. */
async function pruneAndReport(target: string): Promise<number> {
  for (const file of SUPERSEDED) {
    await rm(join(target, file), { force: true });
  }

  // cdk init scaffolds Jest; platform-pkg-dev packages use Vitest, and the generated
  // test refers to the stack class we are about to replace.
  await rm(join(target, 'test'), { recursive: true, force: true });

  // Its entry point is named after the directory; ours is always bin/app.ts.
  for (const stale of await readdir(join(target, 'bin')).catch(() => [])) {
    if (stale !== 'app.ts') await rm(join(target, 'bin', stale), { force: true });
  }
  for (const stale of await readdir(join(target, 'lib')).catch(() => [])) {
    if (stale !== 'main.stack.ts') await rm(join(target, 'lib', stale), { force: true });
  }

  const config = JSON.parse(await readFile(join(target, 'cdk.json'), 'utf8')) as {
    context?: Record<string, unknown>;
  };
  return Object.keys(config.context ?? {}).length;
}

/**
 * Replaces cdk init's `npx tsc && npx tsx` with Node's own type stripping.
 *
 * Node 24 runs TypeScript directly, so the app needs no compile step and no
 * extra runtime dependency - which is the whole reason this toolchain has no
 * tsup, esbuild or tsx in it.
 */
async function pointAppAtTypeStripping(target: string): Promise<void> {
  const path = join(target, 'cdk.json');
  const config = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;

  config['app'] = 'node bin/app.ts';

  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function packageName(cwd: string): string {
  try {
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
      name?: string;
    };
    return manifest.name ?? 'this package';
  } catch {
    return 'this package';
  }
}

/** A CloudFormation-safe stack id derived from the package name. */
function stackId(cwd: string): string {
  const name = packageName(cwd);
  const pascal = name
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part !== '')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  return `${pascal === '' ? 'Main' : pascal}MainStack`;
}
