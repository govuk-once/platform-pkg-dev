import { mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  buildDetachedPackageJson,
  buildPackageJson,
  validatePackageName,
  validateTeam,
  type ScaffoldAnswers,
} from '../lib/package-json.js';
import { CODE_ARTIFACT_ACCOUNT } from '../versions.js';
import { bold, dim, fail, info, ok, step, warn } from '../lib/log.js';
import { ask, closePrompts, confirm } from '../lib/prompt.js';
import { inspectEnvironment, reportPreflight } from '../lib/preflight.js';
import {
  isSeedFile,
  mergeReports,
  planTemplateDir,
  renderTemplateDir,
  writeGenerated,
  type WriteReport,
} from '../lib/render.js';
import { CONFIG_FILE, EXTEND_FILE, renderDetachedConfig } from '../lib/pre-commit.js';
import { FORMAT_CONFIG_FILE } from '../lib/format.js';
import { renderExampleFiles, renderManagedFiles, writeManagedFile } from '../lib/managed.js';
import { gitRoot, packageDirWithinRepo } from '../lib/git.js';
import { runHooks } from './hooks.js';
import { runCdkInit } from './cdk.js';
import { installDependencies } from '../lib/install.js';
import { runTool } from '../lib/toolchain.js';
import { renderWorkspaceFile, workspaceRootFor, WORKSPACE_FILE } from '../lib/workspace.js';

export const INIT_USAGE = `${bold('dev init')} - scaffold a Connect package

Usage
  dev init [options]

Options
  --dir <path>       Target directory (default: current directory)
  --name <name>      Package name, e.g. connect-org
  --team <team>      Owning team
  --pkg-dev <spec>   Dependency spec for platform-pkg-dev itself (default: ^<version>).
                     Use file:../platform-pkg-dev while platform-pkg-dev is unpublished.
  --cdk              Add the AWS CDK dependency set
  --no-cdk           Skip CDK
  --package          Publishable library (adds dual ESM/CJS tsconfigs)
  --no-package       Application, not a published library
  --workspace        Workspace root (adds pnpm-workspace.yaml + packages/)
  --no-workspace     Not a workspace root
  --member           Package inside a workspace: skip the root-only files
  --standalone       Its own repository, even if a workspace root is above it
  --yes              Accept defaults for anything not passed as a flag
  --no-install       Do not run pnpm install after scaffolding
  --detach           Standalone package with no platform-pkg-dev dependency
  --force            Overwrite existing files
  --skip-preflight   Do not verify the pinned tool versions
  --help             Show this message

Membership is detected from the pnpm-workspace.yaml above the package, so
--member and --standalone are only needed to override that. A member does not
get .githooks, .pre-commit-config.yaml, .vscode or .nvmrc: git resolves
core.hooksPath once per repository and pre-commit reads one config, so copies
lower down are files that can never run.
`;

export async function runInit(argv: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      dir: { type: 'string' },
      name: { type: 'string' },
      team: { type: 'string' },
      role: { type: 'string' },
      'pkg-dev': { type: 'string' },
      cdk: { type: 'boolean' },
      'no-cdk': { type: 'boolean' },
      package: { type: 'boolean' },
      'no-package': { type: 'boolean' },
      workspace: { type: 'boolean' },
      'no-workspace': { type: 'boolean' },
      member: { type: 'boolean' },
      standalone: { type: 'boolean' },
      detach: { type: 'boolean' },
      yes: { type: 'boolean', short: 'y' },
      'no-install': { type: 'boolean' },
      force: { type: 'boolean' },
      'skip-preflight': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
  });

  if (values.help === true) {
    info(INIT_USAGE);
    return;
  }

  const targetDir = resolve(values.dir ?? process.cwd());
  const force = values.force === true;
  const acceptDefaults = values.yes === true;

  if (values['skip-preflight'] === true) {
    warn('Skipping environment checks (--skip-preflight)');
  } else {
    step('Checking required commands');
    if (!reportPreflight(inspectEnvironment())) {
      fail(
        'Environment checks failed - nothing was written.',
        'Re-run with --skip-preflight to bypass.',
      );
    }
  }

  // Detected rather than asked: whether a package is a workspace member is a
  // fact about where it sits, not a preference. Resolved before the questions
  // so a member is never asked whether it is a workspace root.
  const root = await workspaceRootFor(targetDir);
  const isMember = values.standalone === true ? false : (values.member ?? root !== undefined);

  if (isMember) {
    info(
      `${dim('Workspace member')}${root === undefined ? '' : dim(` of ${root}`)}` +
        dim(' - git hooks, pre-commit and editor config stay at the root.'),
    );
  }

  try {
    const answers = await collectAnswers(values, targetDir, acceptDefaults, isMember);
    const pkgDevSpec = values['pkg-dev'] ?? `^${await readOwnVersion()}`;

    await scaffold(targetDir, answers, {
      force,
      pkgDevSpec,
      acceptDefaults,
      isMember,
      detach: values.detach === true,
      install: values['no-install'] !== true,
    });
  } finally {
    closePrompts();
  }
}

type InitFlags = {
  name?: string | undefined;
  team?: string | undefined;
  role?: string | undefined;
  cdk?: boolean | undefined;
  'no-cdk'?: boolean | undefined;
  package?: boolean | undefined;
  'no-package'?: boolean | undefined;
  workspace?: boolean | undefined;
  'no-workspace'?: boolean | undefined;
};

/** Resolves a tri-state boolean flag pair into a definite answer. */
function flagPair(
  yes: boolean | undefined,
  no: boolean | undefined,
  name: string,
): boolean | undefined {
  if (yes === true && no === true) fail(`--${name} and --no-${name} cannot both be given.`);
  if (yes === true) return true;
  if (no === true) return false;
  return undefined;
}

async function collectAnswers(
  flags: InitFlags,
  targetDir: string,
  acceptDefaults: boolean,
  isMember: boolean,
): Promise<ScaffoldAnswers> {
  const defaultName = basename(targetDir);

  const role =
    flags.role ??
    (acceptDefaults
      ? fail('--role is required when using --yes.')
      : await ask('AWS role to assume', { flag: '--role' }));

  const packageName =
    flags.name ??
    (acceptDefaults
      ? defaultName
      : await ask('Package name', {
          defaultValue: defaultName,
          flag: '--name',
          validate: validatePackageName,
        }));

  const nameProblem = validatePackageName(packageName);
  if (nameProblem !== undefined) fail(`Invalid package name "${packageName}". ${nameProblem}`);

  const team =
    flags.team ??
    (acceptDefaults
      ? fail('--team is required when using --yes.')
      : await ask('Team', { flag: '--team', validate: validateTeam }));

  const cdk =
    flagPair(flags.cdk, flags['no-cdk'], 'cdk') ??
    (acceptDefaults ? false : await confirm('Add CDK?', { defaultValue: true, flag: '--cdk' }));

  const isPackage =
    flagPair(flags.package, flags['no-package'], 'package') ??
    (acceptDefaults
      ? false
      : await confirm('Is this going to be a published package?', {
          defaultValue: false,
          flag: '--package',
        }));

  // Not asked of a member: a workspace inside a workspace is not a shape worth
  // offering, and the answer would be no every time.
  const isWorkspace =
    flagPair(flags.workspace, flags['no-workspace'], 'workspace') ??
    (acceptDefaults || isMember
      ? false
      : await confirm('Is this a workspace root (packages/* beneath it)?', {
          defaultValue: true,
          flag: '--workspace',
        }));

  return { packageName, team, role, cdk, isPackage, isWorkspace, isMember };
}

/**
 * Warns before overwriting anything that already exists.
 *
 * Without --force nothing is overwritten, so this only reports what will be
 * left alone. With --force it lists the casualties and asks first: silently
 * replacing a package's configuration is not something to discover afterwards.
 */
async function confirmOverwrites(
  targetDir: string,
  answers: ScaffoldAnswers,
  options: { force: boolean; acceptDefaults: boolean },
): Promise<boolean> {
  const planned = [
    'package.json',
    ...(await planTemplateDir('base', targetDir)),
    ...(await planTemplateDir('managed', targetDir)),
    ...(answers.isPackage ? await planTemplateDir('package', targetDir) : []),
    ...(await planTemplateDir('examples', targetDir)),
    // Generated rather than templated, so not covered by planTemplateDir.
    CONFIG_FILE,
    FORMAT_CONFIG_FILE,
  ];

  // Seed files are never overwritten, so they are not at risk either way.
  const existing = [...new Set(planned)]
    .filter((file) => !isSeedFile(file))
    .filter((file) => existsSync(join(targetDir, file)))
    .toSorted();

  if (existing.length === 0) return true;

  if (!options.force) {
    warn(`${existing.length} file(s) already exist and will be left alone:`);
    for (const file of existing) info(`  ${dim(file)}`);
    info(dim('  Pass --force to replace them.'));
    info('');
    return true;
  }

  warn(`--force will OVERWRITE ${existing.length} existing file(s):`);
  for (const file of existing) info(`  ${dim(file)}`);
  info('');

  if (options.acceptDefaults) {
    info(dim('  Proceeding (--yes).'));
    return true;
  }

  return await confirm('Overwrite these files?', { defaultValue: false, flag: '--yes' });
}

/** True when package.json is the throwaway manifest start.sh wrote. */
async function isBootstrapStub(targetDir: string): Promise<boolean> {
  const raw = await readIfPresent(join(targetDir, 'package.json'));
  if (raw === undefined) return false;

  try {
    const parsed = JSON.parse(raw) as { once?: { bootstrap?: unknown } };
    return parsed.once?.bootstrap === true;
  } catch {
    return false;
  }
}

/** Reads a file the package may legitimately not have yet. */
async function readIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

async function readOwnVersion(): Promise<string> {
  const manifest = await readFile(new URL('../../package.json', import.meta.url), 'utf8');
  const parsed = JSON.parse(manifest) as { version?: string };
  return parsed.version ?? '0.0.0';
}

async function scaffold(
  targetDir: string,
  answers: ScaffoldAnswers,
  options: {
    force: boolean;
    pkgDevSpec: string;
    acceptDefaults: boolean;
    isMember: boolean;
    detach: boolean;
    install: boolean;
  },
): Promise<void> {
  if (options.detach) {
    return scaffoldDetached(targetDir, answers, options);
  }

  await mkdir(targetDir, { recursive: true });

  const vars = {
    packageName: answers.packageName,
    team: answers.team,
    role: answers.role,
    cdkNote: answers.cdk ? '\n\n# CDK\ncdk.out/\ncdk.context.json' : '',
    codeArtifactAccount: String(CODE_ARTIFACT_ACCOUNT),
    cdkSection: answers.cdk
      ? [
          '',
          '## CDK',
          '',
          'The CDK app is scaffolded separately, because `cdk init` needs the CDK CLI',
          'and that is not installed until the first `pnpm install`:',
          '',
          '```sh',
          'pnpm dev cdk:init',
          '```',
          '',
          "It runs `cdk init`, then lays this package's `bin/app.ts`,",
          '`lib/main.stack.ts` and `cdk/tsconfig.json` over the result. The generated',
          '`cdk.json` is kept as-is: its feature flags have to match the CDK version,',
          'and hand-maintaining that list would rot on every upgrade.',
          '',
        ].join('\n')
      : '',
  };

  if (!(await confirmOverwrites(targetDir, answers, options))) {
    fail('Cancelled - nothing was written.');
  }

  const reports: WriteReport[] = [];

  step(`Scaffolding ${bold(answers.packageName)} in ${dim(targetDir)}`);

  const bootstrapped = await isBootstrapStub(targetDir);

  reports.push(
    await writeGenerated(targetDir, 'package.json', buildPackageJson(answers, options.pkgDevSpec), {
      force: options.force || bootstrapped,
    }),
  );

  reports.push(
    await renderTemplateDir('base', targetDir, vars, {
      ...options,
      skip: options.isMember ? ['.oxlintrc.json'] : [],
    }),
  );

  const extend = await readIfPresent(join(targetDir, EXTEND_FILE));

  const managedContext = {
    cwd: targetDir,
    packageDir: packageDirWithinRepo(targetDir),
    extend,
    isMember: options.isMember,
  };

  for (const file of [
    ...(await renderManagedFiles(managedContext)),
    ...(await renderExampleFiles(managedContext)),
  ]) {
    const existed = existsSync(join(targetDir, file.path));
    if (existed && !options.force) {
      reports.push({ written: [], skipped: [file.path] });
      continue;
    }
    await writeManagedFile(targetDir, file);
    reports.push({ written: [file.path], skipped: [] });
  }

  if (answers.isPackage) {
    reports.push(await renderTemplateDir('package', targetDir, vars, options));
  }

  if (answers.isWorkspace) {
    reports.push(await writeGenerated(targetDir, WORKSPACE_FILE, renderWorkspaceFile(), options));
    await mkdir(join(targetDir, 'packages'), { recursive: true });
    await writeGenerated(targetDir, join('packages', '.gitkeep'), '', options);
  }

  const { written, skipped } = mergeReports(reports);

  for (const file of written.toSorted()) ok(file);
  for (const file of skipped.toSorted()) warn(`${file} (exists, left alone)`);

  runTool('oxfmt', ['.'], { cwd: targetDir, stdio: 'ignore' });

  if (options.install) {
    info('');
    installDependencies(targetDir);
  }

  const inRepo = gitRoot(targetDir) !== undefined;
  if (options.install && !options.isMember && inRepo) {
    info('');
    await runHooks(['install'], { cwd: targetDir });
  }

  if (options.install && answers.cdk) {
    info('');
    await runCdkInit([], { cwd: targetDir });
  }

  info('');
  info(bold('Next steps'));

  if (!options.install) {
    info(`  pnpm install` + dim('   # skipped (--no-install)'));
  }

  if (options.isMember) {
    info(dim('  The git hooks and editor config come from the workspace root.'));
  } else {
    if (!inRepo) {
      info(`  git init` + dim('   # not yet a repository'));
      info(`  pnpm dev hooks install` + dim('   # wires .githooks, builds the hook envs'));
    }
    info('');
    info(dim('  Install the Oxc VS Code extension (oxc.oxc-vscode) - see README.md.'));
  }
  if (skipped.length > 0) {
    info('');
    info(dim('Re-run with --force to overwrite the files that were left alone.'));
  }
}

async function scaffoldDetached(
  targetDir: string,
  answers: ScaffoldAnswers,
  options: {
    force: boolean;
    acceptDefaults: boolean;
    install: boolean;
  },
): Promise<void> {
  await mkdir(targetDir, { recursive: true });

  const vars = {
    packageName: answers.packageName,
    team: answers.team,
    role: answers.role,
    cdkNote: answers.cdk ? '\n\n# CDK\ncdk.out/\ncdk.context.json' : '',
    codeArtifactAccount: String(CODE_ARTIFACT_ACCOUNT),
    cdkSection: '',
  };

  if (!(await confirmOverwrites(targetDir, answers, options))) {
    fail('Cancelled - nothing was written.');
  }

  const reports: WriteReport[] = [];

  step(`Scaffolding ${bold(answers.packageName)} (detached) in ${dim(targetDir)}`);

  const bootstrapped = await isBootstrapStub(targetDir);

  reports.push(
    await writeGenerated(targetDir, 'package.json', buildDetachedPackageJson(answers), {
      force: options.force || bootstrapped,
    }),
  );

  // Detached templates: standalone tsconfig, oxlintrc, vitest.config (no extends)
  reports.push(await renderTemplateDir('detached', targetDir, vars, options));

  // Seed files from base: src/index.ts, src/types.ts, src/index.test.ts, .gitignore
  reports.push(
    await renderTemplateDir('base', targetDir, vars, {
      ...options,
      skip: ['tsconfig.json', '.oxlintrc.json', 'vitest.config.ts', 'README.md'],
    }),
  );

  // Static pre-commit config with direct tool calls
  const preCommitConfig = await renderDetachedConfig();
  reports.push(await writeGenerated(targetDir, CONFIG_FILE, preCommitConfig, options));

  if (answers.isPackage) {
    reports.push(await renderTemplateDir('package', targetDir, vars, options));
  }

  const { written, skipped } = mergeReports(reports);

  for (const file of written.toSorted()) ok(file);
  for (const file of skipped.toSorted()) warn(`${file} (exists, left alone)`);

  // Format with oxfmt (resolved from platform-pkg-dev at scaffold time)
  runTool('oxfmt', ['.'], { cwd: targetDir, stdio: 'ignore' });

  if (options.install) {
    info('');
    installDependencies(targetDir);
  }

  const inRepo = gitRoot(targetDir) !== undefined;
  if (options.install && inRepo) {
    info('');
    step('Wiring git hooks');
    const { spawnSync } = await import('node:child_process');
    spawnSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: targetDir });
    ok('core.hooksPath -> .githooks');
  }

  if (options.install && answers.cdk) {
    info('');
    await runCdkInit([], { cwd: targetDir });
  }

  info('');
  info(bold('Next steps'));
  if (!options.install) {
    info(`  pnpm install`);
  }
  if (!inRepo) {
    info(`  git init`);
  }
  info(`  git config core.hooksPath .githooks`);
  info('');
  info(dim('  This package is standalone - it does not depend on platform-pkg-dev.'));
  info(dim('  All config files are owned by this package and can be edited directly.'));
}
