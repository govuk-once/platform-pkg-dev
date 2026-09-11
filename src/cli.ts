#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { INIT_USAGE, runInit } from './commands/init.js';
import {
  runBuild,
  runLint,
  runTest,
  runTestWatch,
  runTypecheck,
  runFormat,
  runWriteMarkers,
  runSpell,
  type RunContext,
} from './commands/run.js';
import { runSync, SYNC_USAGE } from './commands/sync.js';
import { PRE_COMMIT_USAGE, PRE_PUSH_USAGE, runPreCommit, runPrePush } from './commands/checks.js';
import { HOOKS_USAGE, runHooks } from './commands/hooks.js';
import { CDK_USAGE, runCdkInit } from './commands/cdk.js';
import { SYNTH_USAGE, runSynth } from './commands/synth.js';
import { SCAN_USAGE, runScan } from './commands/scan.js';
import { inspectEnvironment, reportPreflight } from './lib/preflight.js';
import { bold, dim, error, fail, info } from './lib/log.js';
import { resolveWorkingDir } from './lib/project.js';

const USAGE = `${bold('dev')} - core tooling for Connect packages, provided by platform-pkg-dev

Usage
  dev <command> [options]

Commands
  init         Scaffold a new Connect package in the current directory
  build        Compile with the pinned TypeScript (dual ESM/CJS when configured)
  test         Run Vitest once
  test:watch   Run Vitest in watch mode, re-running affected tests on save
  lint         Run oxlint with the shared Connect config (--fix to apply fixes)
  format       Run oxfmt (--check to verify without writing)
  typecheck    Run tsc --noEmit
  sync         Enforce the dependency versions platform-pkg-dev pins (--check for CI)
  pre-commit   Run the commit-stage hooks now (hygiene, secrets, semgrep, lint)
  pre-push     Run the push-stage hooks now (checkov, test)
  hooks        install / status / uninstall the .githooks wiring
  cdk:init     Scaffold the CDK app: cdk init, then platform-pkg-dev's stack on top
  synth        Assume the GDS role, then synthesise the CDK app
  scan         Synthesise, then run checkov over the templates
  spell         Run CSpell to look for spelling issues
  doctor       Verify the pinned tool versions on this machine
  write-markers  Write the dist/esm and dist/cjs package.json type markers
                 (build does this for you after a successful dual build)
  version      Print the platform-pkg-dev version
  help         Show this message

Options
  --cwd <path>  Run against this package instead of the current directory

${dim('build, test, lint and typecheck resolve their binaries from platform-pkg-dev, so')}
${dim('TypeScript never has to be a direct dependency. A few tools are pinned into')}
${dim('the package anyway - Vitest because test files import it by name, oxlint and')}
${dim('oxfmt because the editor extension looks for them in the workspace. `dev')}
${dim('sync` adds those for you.')}
${dim('')}
${dim('They also run from the nearest package root, so calling them from a')}
${dim('subdirectory behaves the same as calling them from the top.')}

Run ${bold('dev init --help')} for the init options.
`;

/**
 * Pulls `--cwd <path>` (or `--cwd=<path>`) out of the argument list before the
 * rest is forwarded verbatim to the underlying tool.
 */
function extractCwd(argv: readonly string[]): { cwd: string | undefined; rest: string[] } {
  const rest: string[] = [];
  let cwd: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;

    if (arg === '--cwd') {
      const value = argv[i + 1];
      if (value === undefined) fail('--cwd requires a path.');
      cwd = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--cwd=')) {
      cwd = arg.slice('--cwd='.length);
      continue;
    }

    rest.push(arg);
  }

  return { cwd, rest };
}

async function version(): Promise<string> {
  const manifest = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  return (JSON.parse(manifest) as { version?: string }).version ?? '0.0.0';
}

async function main(argv: readonly string[]): Promise<number> {
  const [command = 'help', ...rest] = argv;

  switch (command) {
    case 'init':
      await runInit(rest);
      return 0;

    case 'build':
    case 'test':
    case 'test:watch':
    case 'lint':
    case 'typecheck':
    case 'format':
    case 'sync':
    case 'pre-commit':
    case 'pre-push':
    case 'hooks':
    case 'doctor':
    case 'cdk:init':
    case 'synth':
    case 'scan':
    case 'spell':
    case 'write-markers': {
      const { cwd, rest: toolArgs } = extractCwd(rest);
      const context: RunContext = { cwd: resolveWorkingDir(cwd) };

      if (command === 'cdk:init') return await runCdkInit(toolArgs, context);
      if (command === 'synth') return await runSynth(toolArgs, context);
      if (command === 'scan') return await runScan(toolArgs, context);

      if (command === 'build') return await runBuild(toolArgs, context);
      if (command === 'test') return runTest(toolArgs, context);
      if (command === 'test:watch') return runTestWatch(toolArgs, context);
      if (command === 'lint') return runLint(toolArgs, context);
      if (command === 'format') return runFormat(toolArgs, context);
      if (command === 'sync') return await runSync(toolArgs, context);
      if (command === 'pre-commit') return await runPreCommit(toolArgs, context);
      if (command === 'pre-push') return await runPrePush(toolArgs, context);
      if (command === 'hooks') return await runHooks(toolArgs, context);
      if (command === 'doctor') return reportPreflight(inspectEnvironment()) ? 0 : 1;
      if (command === 'spell') return runSpell(toolArgs, context);
      if (command === 'write-markers') return await runWriteMarkers(context);
      return runTypecheck(toolArgs, context);
    }

    case 'version':
    case '--version':
    case '-v':
      info(await version());
      return 0;

    case 'help':
    case '--help':
    case '-h': {
      const topic = rest[0];
      if (topic === 'init') info(INIT_USAGE);
      else if (topic === 'sync') info(SYNC_USAGE);
      else if (topic === 'pre-commit') info(PRE_COMMIT_USAGE);
      else if (topic === 'pre-push') info(PRE_PUSH_USAGE);
      else if (topic === 'hooks') info(HOOKS_USAGE);
      else if (topic === 'cdk:init' || topic === 'cdk') info(CDK_USAGE);
      else if (topic === 'synth') info(SYNTH_USAGE);
      else if (topic === 'scan') info(SCAN_USAGE);
      else info(USAGE);
      return 0;
    }

    default:
      error(`Unknown command "${command}".`);
      info(USAGE);
      return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
