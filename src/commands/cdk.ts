import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, readFile as readFileAsync, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { bold, dim, fail, info, ok, step, warn } from '../lib/log.js';
import { binPath, runTool } from '../lib/toolchain.js';
import { renderTemplateDir, substitute, TEMPLATES_ROOT } from '../lib/render.js';
import {
  buildFunctionsPackageJson,
  FUNCTIONS_DIR,
  SAM_EXAMPLES,
  type SamExample,
} from '../lib/functions-package.js';
import { installDependencies } from '../lib/install.js';
import {
  addWorkspacePackage,
  readWorkspaceFile,
  renderWorkspaceFile,
  WORKSPACE_FILE,
  workspaceRootFor,
} from '../lib/workspace.js';
import type { RunContext } from './run.js';

export const CDK_USAGE = `${bold('dev cdk:init')} - scaffold the CDK app for this package

Usage
  dev cdk:init [options]

Options
  --dir <name>  Directory to create, relative to the package (default: cdk)
  --sam              Include SAM local dev (API GW + Lambda example)
  --sam-example <t>  Example stacks, comma-separated: dsql, dynamo (default), queue
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
      sam: { type: 'boolean' },
      'sam-example': { type: 'string' },
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
  const samExamples = parseSamExamples(values['sam-example']);
  const vars = { packageName: packageName(context.cwd), stackId: stackId(context.cwd) };

  // The main app is the same with or without SAM: bin/app.ts and lib/main.stack.ts,
  // with no SAM code in them. SAM gets an app of its own, bin/sam.app.ts.
  const written = await renderTemplateDir('cdk', target, vars, { force: true });
  for (const file of written.written.toSorted()) ok(join(name, file));

  if (values.sam === true) {
    const stacksDir = join('lib', 'stacks', 'sam');
    await mkdir(join(target, stacksDir), { recursive: true });

    for (const ex of samExamples) {
      const stackFile = SAM_STACKS[ex].file;
      const content = substitute(
        await readFileAsync(join(TEMPLATES_ROOT, 'sam-stacks', stackFile), 'utf8'),
        vars,
      );
      await writeFile(join(target, stacksDir, stackFile), content, 'utf8');
      ok(join(name, stacksDir, stackFile));

      // Every example stack points sam:source-entry at src/sam/.
      const handlerDir = join(FUNCTIONS_DIR, 'sam');
      const handlerWritten = await renderTemplateDir(
        `sam-handlers/${ex}`,
        join(context.cwd, handlerDir),
        vars,
        { force: false },
      );
      for (const file of handlerWritten.written.toSorted()) ok(join(handlerDir, file));
      for (const file of handlerWritten.skipped)
        info(dim(`  skipped ${handlerDir}/${file} (exists)`));
    }

    await writeFile(join(target, 'bin', 'sam.app.ts'), buildSamApp(samExamples), 'utf8');
    ok(join(name, 'bin', 'sam.app.ts'));

    await scaffoldFunctionsPackage(context.cwd, samExamples);
  }

  const app = await pointAppAtBundler(target, context.cwd);
  ok(`${join(name, 'cdk.json')} app -> ${app}`);

  // cdk init's output and the cdk.json rewrite land after `dev init` formatted the
  // package, so format them here or the first commit fails the format hook.
  runTool('oxfmt', [name], { cwd: context.cwd, stdio: 'ignore' });

  // src/package.json is new, so node_modules does not match it until pnpm runs.
  if (values.sam === true) {
    info('');
    const root = (await workspaceRootFor(context.cwd)) ?? context.cwd;
    if (installDependencies(root) !== 0)
      warn('pnpm install failed - run it before `dev sam:start`.');
  }

  info('');
  info(bold('Next steps'));
  if (values.sam === true) {
    info(`  Start the local API:`);
    info(`  ${dim('dev sam:start')}`);
  } else {
    info(`  cd ${name} && pnpm exec cdk synth`);
  }

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

  const config = JSON.parse(await readFileAsync(join(target, 'cdk.json'), 'utf8')) as {
    context?: Record<string, unknown>;
  };
  return Object.keys(config.context ?? {}).length;
}

/**
 * Replaces cdk init's `npx tsc && npx tsx` with `dev cdk:app`, which bundles the
 * app with esbuild and runs it. Unlike plain `node bin/app.ts`, that lets relative
 * imports be written the normal way - no extension, or .js - in every file.
 *
 * The binary is named by its path, not via npx or pnpm exec: cdk runs the app
 * from the CDK directory, which has no package.json of its own.
 */
async function pointAppAtBundler(target: string, packageRoot: string): Promise<string> {
  const path = join(target, 'cdk.json');
  const config = JSON.parse(await readFileAsync(path, 'utf8')) as Record<string, unknown>;

  const app = `${relative(target, join(packageRoot, 'node_modules', '.bin', 'dev'))} cdk:app`;
  config['app'] = app;

  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return app;
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

/** Each example's stack template (in templates/sam-stacks), class name and stack id. */
const SAM_STACKS: Readonly<Record<SamExample, { file: string; cls: string; id: string }>> = {
  dsql: { file: 'sam-dsql.stack.ts', cls: 'SAMDSQLStack', id: 'SAMDsqlStack' },
  dynamo: { file: 'sam-dynamo-db.stack.ts', cls: 'SAMDynamoDBStack', id: 'SAMDynamoStack' },
  queue: { file: 'sam-queue.stack.ts', cls: 'SAMQueueStack', id: 'SAMQueueStack' },
};

function parseSamExamples(flag: string | undefined): SamExample[] {
  const names = (flag ?? 'dynamo').split(',').map((name) => name.trim());
  for (const name of names) {
    if (!SAM_EXAMPLES.includes(name as SamExample)) {
      fail(`Unknown --sam-example "${name}".`, `Choose from: ${SAM_EXAMPLES.join(', ')}.`);
    }
  }
  return [...new Set(names)] as SamExample[];
}

/**
 * Makes src/ the Lambda package: its own package.json and tsconfig, registered in
 * the workspace so pnpm installs it. The SAM wrapper bundles each handler against
 * the nearest package.json, so handler deps resolve from src/ - never the CDK root.
 */
async function scaffoldFunctionsPackage(
  cwd: string,
  examples: readonly SamExample[],
): Promise<void> {
  const dir = join(cwd, FUNCTIONS_DIR);
  const manifestPath = join(dir, 'package.json');
  const existing = existsSync(manifestPath) ? await readFileAsync(manifestPath, 'utf8') : undefined;

  await mkdir(dir, { recursive: true });
  await writeFile(
    manifestPath,
    buildFunctionsPackageJson(packageName(cwd), examples, existing),
    'utf8',
  );
  ok(join(FUNCTIONS_DIR, 'package.json'));

  const tsconfig = await renderTemplateDir('sam-functions', dir, {}, { force: false });
  for (const file of tsconfig.written) ok(join(FUNCTIONS_DIR, file));

  // A workspace member's src/ is registered with the workspace root, not itself.
  const root = (await workspaceRootFor(cwd)) ?? cwd;
  const glob = relative(root, dir);
  const current = await readWorkspaceFile(root);
  const next =
    current === undefined ? renderWorkspaceFile([glob]) : addWorkspacePackage(current, glob);

  if (next !== current) {
    await writeFile(join(root, WORKSPACE_FILE), next, 'utf8');
    ok(`${relative(cwd, join(root, WORKSPACE_FILE))} packages += ${glob}`);
  }
}

/** bin/sam.app.ts: the local-only app `dev sam:start` runs. Deploys use bin/app.ts. */
function buildSamApp(examples: readonly SamExample[]): string {
  const imports = examples
    .map((ex) => {
      const { cls, file } = SAM_STACKS[ex];
      return `import { ${cls} } from '../lib/stacks/sam/${file.replace(/\.ts$/, '.js')}';`;
    })
    .join('\n');

  const stacks = examples
    .map((ex) => `new ${SAM_STACKS[ex].cls}(app, '${SAM_STACKS[ex].id}');`)
    .join('\n\n');

  return `import { App, Aspects } from 'aws-cdk-lib';

${imports}

const app = new App();

${stacks}

if (process.env['SAM_LOCAL'] === 'true') {
  const { SAMLocalAspect } = await import('@govuk-connect/dev/sam');
  Aspects.of(app).add(new SAMLocalAspect(app));
}
`;
}
