import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { bold, fail, info } from '../lib/log.js';

export const CDK_APP_USAGE = `${bold('dev cdk:app')} - bundle and run the CDK app

Usage
  dev cdk:app [entry]

cdk.json's \`app\` command, so \`cdk synth\`, \`cdk deploy\`, \`dev synth\` and
\`dev sam:start\` all run the app through it.

Bundles the entry (default: bin/app.ts, relative to the current directory) and
everything it imports with esbuild, runs the bundle with Node, then deletes it.
Relative imports can be written without an extension, or with .js, as in any
TypeScript project. Installed packages are left out of the bundle and load from
node_modules as normal.
`;

/** Prefix of the temporary bundle; also listed in the generated .gitignore. */
export const BUNDLE_PREFIX = '.cdk-app-';

export async function runCdkApp(argv: readonly string[]): Promise<number> {
  if (argv[0] === '--help' || argv[0] === '-h') {
    info(CDK_APP_USAGE);
    return 0;
  }

  const entry = resolve(process.cwd(), argv[0] ?? 'bin/app.ts');
  if (!existsSync(entry)) fail(`CDK app entry not found: ${entry}`);

  // Written next to the entry so paths the app builds from its own location still
  // point where they did. Per-process, so concurrent synths do not collide.
  const outfile = join(dirname(entry), `${BUNDLE_PREFIX}${process.pid}.mjs`);

  const { build } = await import('esbuild');
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    packages: 'external',
    sourcemap: 'inline',
    logLevel: 'warning',
  });

  try {
    const result = spawnSync(process.execPath, ['--enable-source-maps', outfile], {
      stdio: 'inherit',
      env: process.env,
    });
    if (result.error !== undefined) fail(`Failed to run the CDK app: ${result.error.message}`);
    return result.status ?? 1;
  } finally {
    await rm(outfile, { force: true });
  }
}
