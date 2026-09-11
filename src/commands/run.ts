import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runTool } from '../lib/toolchain.js';
import { dim, step } from '../lib/log.js';

/** Where the toolchain runs: the package root, not the caller's cwd. */
export interface RunContext {
  readonly cwd: string;
}

/** `dev test [...]` - Vitest, resolved from platform-pkg-dev's dependencies. */
export function runTest(argv: readonly string[], context: RunContext): number {
  const args = argv.length > 0 ? argv : ['run'];
  return runTool('vitest', args, { cwd: context.cwd });
}

/**
 * `dev test:watch [...]` - Vitest in watch mode.
 *
 * Re-runs only the tests affected by whatever you just saved, using Vitest's
 * own dependency graph. Any extra arguments are passed through, so
 * `dev test:watch tag` filters to matching test files.
 */
export function runTestWatch(argv: readonly string[], context: RunContext): number {
  return runTool('vitest', ['watch', ...argv], { cwd: context.cwd });
}

/**
 * `dev lint [...]` - oxlint, defaulting to the whole package.
 *
 * Type-aware rules are on whenever the package has a tsconfig.json: oxlint is
 * fast enough that there is no reason to run the weaker syntactic-only pass,
 * and rules like no-floating-promises only exist in the type-aware set.
 */
export function runLint(argv: readonly string[], context: RunContext): number {
  const args = [...argv];

  // `dev lint --fix` should still lint the whole package with type information.
  // Only add the defaults the caller has not already supplied.
  const hasPath = args.some((arg) => !arg.startsWith('-'));
  const wantsTypeAware = existsSync(join(context.cwd, 'tsconfig.json'));

  if (wantsTypeAware && !args.includes('--type-aware')) args.unshift('--type-aware');
  if (!hasPath) args.push('.');

  return runTool('oxlint', args, { cwd: context.cwd });
}

/**
 * `dev spell [...]` - cpell, defaulting to the whole package.
 *
 * CSpell spellchecker
 */
export function runSpell(argv: readonly string[], context: RunContext): number {
  const args = [...argv, '"./src/**/*.ts"'];
  // TODO: fill out options for cspell, add ext functionality
  return runTool('cspell', args, { cwd: context.cwd });
}

/**
 * `dev format [...]` - oxfmt, writing in place unless --check is passed.
 *
 * Formatting is not linting: oxlint reports code smells and has no opinion on
 * spacing or semicolons, so a formatter is a separate tool.
 */
export function runFormat(argv: readonly string[], context: RunContext): number {
  const args = [...argv];
  if (!args.some((arg) => !arg.startsWith('-'))) args.push('.');
  return runTool('oxfmt', args, { cwd: context.cwd });
}

/** `dev typecheck [...]` - tsc --noEmit against the package tsconfig. */
export function runTypecheck(argv: readonly string[], context: RunContext): number {
  const args = argv.length > 0 ? argv : ['-p', 'tsconfig.json', '--noEmit'];
  return runTool('typescript', args, { binName: 'tsc', cwd: context.cwd });
}

/**
 * `dev build [...]`
 *
 * When the package carries tsconfig.esm.json and tsconfig.cjs.json it is a
 * publishable library: both are compiled and each output directory gets a
 * package.json marker so Node reads the right module format. Otherwise this is
 * a plain `tsc -p tsconfig.json`.
 */
export async function runBuild(argv: readonly string[], context: RunContext): Promise<number> {
  const tsc = (args: readonly string[]): number =>
    runTool('typescript', args, { binName: 'tsc', cwd: context.cwd });

  if (argv.length > 0) return tsc(argv);

  const dual =
    existsSync(join(context.cwd, 'tsconfig.esm.json')) &&
    existsSync(join(context.cwd, 'tsconfig.cjs.json'));

  if (!dual) return tsc(['-p', 'tsconfig.json']);

  step(`Building ESM ${dim(context.cwd)}`);
  const esmStatus = tsc(['-p', 'tsconfig.esm.json']);
  if (esmStatus !== 0) return esmStatus;

  step('Building CJS');
  const cjsStatus = tsc(['-p', 'tsconfig.cjs.json']);
  if (cjsStatus !== 0) return cjsStatus;

  await runWriteMarkers(context);

  return 0;
}

/**
 * `dev write-markers`
 *
 * Normally runs automatically at the end of a successful dual build. Exposed as
 * its own command for builds driven from somewhere other than `dev build`.
 */
export async function runWriteMarkers(context: RunContext): Promise<number> {
  await writeModuleMarker(join(context.cwd, 'dist', 'esm'), 'module');
  await writeModuleMarker(join(context.cwd, 'dist', 'cjs'), 'commonjs');
  return 0;
}

/**
 * Node decides a .js file's module format from the nearest package.json, and a
 * published package's root says `"type": "module"` - which would make the
 * CommonJS output in dist/cjs load as ESM. A `type` marker in each output
 * directory scopes the format to that subtree. Bundlers avoid this by emitting
 * .cjs/.mjs extensions; with plain tsc these markers are the equivalent.
 */
async function writeModuleMarker(dir: string, type: 'module' | 'commonjs'): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`, 'utf8');
}
