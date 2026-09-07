import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { bold, dim, error, fail, info, ok, step, warn } from '../lib/log.js';
import { applyDrift, computeDrift, describeDrift, type Manifest } from '../lib/pins.js';
import { EXTEND_FILE, ExtendError } from '../lib/pre-commit.js';
import { installDependencies } from '../lib/install.js';
import { packageDirWithinRepo } from '../lib/git.js';
import { latestVersion, versionSource } from '../lib/registry.js';
import { isNewer, isRegistrySpec } from '../lib/semver.js';
import { isBuildStale, pkgDevRoot } from '../lib/staleness.js';
import {
  applyWorkspaceSettings,
  readWorkspaceFile,
  workspaceRootFor,
  WORKSPACE_FILE,
} from '../lib/workspace.js';
import {
  renderExampleFiles,
  renderManagedFiles,
  readManagedFile,
  writeManagedFile,
} from '../lib/managed.js';
import type { RunContext } from './run.js';

export const SYNC_USAGE = `${bold('dev sync')} - enforce the dependency versions platform-pkg-dev owns

Usage
  dev sync [options]

Options
  --check       Report drift and exit non-zero without changing anything
  --no-install  Do not run pnpm install after rewriting package.json
  --no-upgrade  Do not check the registry for a newer platform-pkg-dev
  --cwd <path>  Run against this package instead of the current directory
  --help        Show this message

Enforces two files against platform-pkg-dev's versions.json:

  package.json             @types/node and oxlint-tsgolint always, the CDK set
                           for packages that use it, plus packageManager and
                           engines.node
  managed files            .pre-commit-config.yaml, .oxfmtrc.json, .nvmrc,
                           .githooks/ and .vscode/ - formats with no \`extends\`
                           mechanism, so platform-pkg-dev regenerates them outright

It also checks whether a newer platform-pkg-dev has been published and, if so, upgrades
this package to it before syncing - the pins come from platform-pkg-dev, so syncing
against an old copy would just reapply old versions. A \`link:\` or \`file:\` spec
is left alone, and a registry that cannot be reached is not an error.
`;

export async function runSync(argv: readonly string[], context: RunContext): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      check: { type: 'boolean' },
      'no-install': { type: 'boolean' },
      'no-upgrade': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (values.help === true) {
    info(SYNC_USAGE);
    return 0;
  }

  const manifestPath = join(context.cwd, 'package.json');

  let raw: string;
  try {
    raw = await readFile(manifestPath, 'utf8');
  } catch {
    fail(`Could not read ${manifestPath}.`);
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(raw) as Manifest;
  } catch (cause) {
    fail(`${manifestPath} is not valid JSON.`, (cause as Error).message);
  }

  // Upgrading without installing would leave package.json claiming a version
  // that is not on disk, so --no-install disables the check rather than doing
  // half of it.
  if (values.check !== true && values['no-upgrade'] !== true && values['no-install'] !== true) {
    const upgraded = await upgradePkgDev(manifest, manifestPath, context.cwd, raw);
    if (upgraded !== undefined) return upgraded;
  }

  await reportVersion(
    context.cwd,
    manifest.devDependencies?.['platform-pkg-dev'] ?? manifest.dependencies?.['platform-pkg-dev'],
  );

  // Nothing rebuilds a linked platform-pkg-dev, so its dist can lag its src and the
  // package silently runs old code. Say so rather than let it confuse someone.
  if (isBuildStale()) {
    warn('platform-pkg-dev has uncompiled changes - you may be running an old build.');
    process.stderr.write(`  ${dim(`pnpm --dir ${pkgDevRoot()} build`)}\n`);
  }

  const isMember = (await workspaceRootFor(context.cwd)) !== undefined;

  const drift = computeDrift(manifest, { isMember });

  // Everything platform-pkg-dev owns outright. tsconfig and .oxlintrc.json are absent
  // deliberately: those formats support `extends`, so they track platform-pkg-dev
  // without being rewritten.
  let managed;
  try {
    managed = await renderManagedFiles({
      cwd: context.cwd,
      packageDir: packageDirWithinRepo(context.cwd),
      extend: await readIfPresent(join(context.cwd, EXTEND_FILE)),
      isMember,
    });
  } catch (cause) {
    if (cause instanceof ExtendError) fail(cause.message);
    throw cause;
  }

  // Examples are only wanted while the real file does not exist, so they are
  // gathered separately rather than being enforced unconditionally.
  const wanted = [
    ...managed,
    ...(await renderExampleFiles({
      cwd: context.cwd,
      packageDir: packageDirWithinRepo(context.cwd),
      extend: undefined,
      isMember,
    })),
  ];

  const stale: typeof wanted = [];
  for (const file of wanted) {
    if ((await readManagedFile(context.cwd, file)) !== file.content) stale.push(file);
  }

  // Only for packages that are a workspace root. platform-pkg-dev owns a few settings
  // inside the file but never the package globs, so this is a merge rather than
  // another managed file.
  const workspace = await readWorkspaceFile(context.cwd);
  const workspaceUpdate = workspace === undefined ? undefined : applyWorkspaceSettings(workspace);
  const workspaceDrift = workspaceUpdate?.drift ?? [];

  if (drift.length === 0 && stale.length === 0 && workspaceDrift.length === 0) {
    ok(
      `package.json and ${wanted.length} managed files match platform-pkg-dev ${dim(context.cwd)}`,
    );
    return 0;
  }

  if (values.check === true) {
    error('This package has drifted from platform-pkg-dev:');
    for (const change of drift) process.stderr.write(`  ${describeDrift(change)}\n`);
    for (const file of stale) process.stderr.write(`  ~ ${file.path}\n`);
    for (const change of workspaceDrift) {
      process.stderr.write(
        `  ~ ${WORKSPACE_FILE}: ${change.key} ${change.from ?? '(unset)'} -> ${change.to}\n`,
      );
    }
    process.stderr.write(`  ${dim('Run `dev sync` to fix.')}\n`);
    return 1;
  }

  if (drift.length > 0) {
    applyDrift(manifest, drift);
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    for (const change of drift) info(`  ${describeDrift(change)}`);
  }

  for (const file of stale) {
    await writeManagedFile(context.cwd, file);
    info(`  ~ ${file.path}`);
  }

  if (workspaceUpdate !== undefined && workspaceDrift.length > 0) {
    await writeFile(join(context.cwd, WORKSPACE_FILE), workspaceUpdate.content, 'utf8');
    for (const change of workspaceDrift) {
      info(
        `  ~ ${WORKSPACE_FILE}: ${change.key} ${dim(`${change.from ?? '(unset)'} ->`)} ${change.to}`,
      );
    }
  }

  const total = drift.length + stale.length + workspaceDrift.length;
  ok(`Applied ${total} change${total === 1 ? '' : 's'}`);

  if (drift.length === 0) return 0;

  if (values['no-install'] === true) {
    info(dim('  Skipping install (--no-install). Run `pnpm install` to apply.'));
    return 0;
  }

  return installDependencies(context.cwd);
}

/**
 * States which platform-pkg-dev is in charge, and where it would look for a newer one.
 *
 * Printed on every run, including --check: which copy is driving the pins is
 * the first thing you want to know when a sync does something surprising, and
 * "am I on the local checkout or the released one?" should never be a guess.
 * Costs nothing - the version is read from disk, not fetched.
 */
async function reportVersion(cwd: string, spec: string | undefined): Promise<void> {
  const installed = (await readInstalledVersion()) ?? 'unknown version';
  const source = versionSource(cwd);

  // A local spec is the common case during development, and "sync did nothing"
  // is a confusing way to discover that upgrades do not apply to it.
  if (spec !== undefined && !isRegistrySpec(spec)) {
    step(
      `platform-pkg-dev ${installed} ${dim(`(${spec} - upgrades not applied to a local spec)`)}`,
    );
    return;
  }

  if (source === undefined) {
    step(`platform-pkg-dev ${installed} ${dim('(update check disabled)')}`);
    return;
  }

  if (source.startsWith('file:')) {
    step(`platform-pkg-dev ${installed} ${dim(`(local dev: ${fileURLToPath(source)})`)}`);
    return;
  }

  step(`platform-pkg-dev ${installed} ${dim(`(updates from ${source})`)}`);
}

/** Guards against an upgraded platform-pkg-dev re-running the upgrade forever. */
const REENTRY = 'DEV_SYNC_UPGRADED';

/**
 * Upgrades this package to a newer published platform-pkg-dev, then re-runs sync under
 * it.
 *
 * The re-run matters: every pin this command enforces comes from platform-pkg-dev, so
 * the process already in memory would happily reapply the versions it shipped
 * with. Returns an exit code when it handled things, or undefined to carry on.
 */
async function upgradePkgDev(
  manifest: Manifest,
  manifestPath: string,
  cwd: string,
  raw: string,
): Promise<number | undefined> {
  if (process.env[REENTRY] === '1') return undefined;

  const spec =
    manifest.devDependencies?.['platform-pkg-dev'] ?? manifest.dependencies?.['platform-pkg-dev'];
  if (spec === undefined || !isRegistrySpec(spec)) return undefined;

  const installed = await readInstalledVersion();
  if (installed === undefined) return undefined;

  const latest = await latestVersion(cwd);
  if (latest === undefined || !isNewer(latest, installed)) return undefined;

  step(`platform-pkg-dev ${installed} -> ${latest}`);

  const updated = raw.replace(
    new RegExp(`("platform-pkg-dev"\\s*:\\s*)"${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
    `$1"^${latest}"`,
  );

  if (updated === raw) {
    warn('Could not rewrite the platform-pkg-dev spec; leaving it alone.');
    return undefined;
  }

  await writeFile(manifestPath, updated, 'utf8');

  const status = installDependencies(cwd);
  if (status !== 0) {
    // Put the manifest back: a package pinned to a version that could not be
    // installed is worse off than one that simply has not upgraded yet.
    await writeFile(manifestPath, raw, 'utf8');
    error(`Could not install platform-pkg-dev ${latest}; left this package on ${installed}.`);
    return status;
  }

  // Re-exec so the rest of the sync runs under the version just installed.
  step('Re-running sync under the new platform-pkg-dev');
  const result = spawnSync(
    process.execPath,
    [join(cwd, 'node_modules/platform-pkg-dev/dist/cli.js'), 'sync'],
    {
      stdio: 'inherit',
      cwd,
      env: { ...process.env, [REENTRY]: '1' },
    },
  );

  return result.status ?? 1;
}

/** The platform-pkg-dev version actually running, read from its own manifest. */
async function readInstalledVersion(): Promise<string | undefined> {
  try {
    const own = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
    const parsed = JSON.parse(own) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : undefined;
  } catch {
    return undefined;
  }
}

/** Reads a file a package may legitimately not have yet. */
async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}
