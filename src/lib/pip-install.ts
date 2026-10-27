import { spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { which } from './which.js';
import { ok, step, error, dim } from './log.js';

export function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function allPythons(): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const path = process.env['PATH'];
  if (path === undefined) return result;

  for (const dir of path.split(delimiter)) {
    if (dir === '') continue;
    for (const name of ['python3', 'python']) {
      const candidate = join(dir, name);
      try {
        if (!statSync(candidate).isFile()) continue;
        accessSync(candidate, constants.X_OK);
        if (!seen.has(candidate)) {
          seen.add(candidate);
          result.push(candidate);
        }
      } catch {
        // Not here.
      }
    }
  }
  return result;
}

export interface PipToolConfig {
  readonly pipPackage: string;
  readonly binName: string;
  readonly version: string;
}

function pipDir(config: PipToolConfig): string {
  return `node_modules/.pip/${config.pipPackage}`;
}

function pipBin(config: PipToolConfig): string {
  return join(pipDir(config), 'bin', config.binName);
}

function nodeBin(config: PipToolConfig): string {
  return join('node_modules', '.bin', config.binName);
}

function cacheDir(config: PipToolConfig): string {
  return join(homedir(), '.gds-dev', 'cache', config.pipPackage, config.version);
}

export function resolvePipTool(cwd: string, config: PipToolConfig): string | undefined {
  const local = join(cwd, nodeBin(config));
  if (isExecutable(local)) return local;
  return which(config.binName);
}

function writeWrapper(link: string, config: PipToolConfig): void {
  try {
    unlinkSync(link);
  } catch {
    // Not there yet.
  }
  mkdirSync(join(link, '..'), { recursive: true });

  const pip = pipDir(config);
  const bin = pipBin(config);
  const wrapper = [
    '#!/bin/sh',
    'DIR="$(cd "$(dirname "$0")/.." && pwd)"',
    `PYTHONPATH="$DIR/${pip.replace('node_modules/', '')}" exec "$DIR/${bin.replace('node_modules/', '')}" "$@"`,
    '',
  ].join('\n');
  writeFileSync(link, wrapper, 'utf8');
  chmodSync(link, 0o755);
}

function restoreFromCache(cwd: string, config: PipToolConfig): boolean {
  const cached = cacheDir(config);
  const cachedBin = join(cached, 'bin', config.binName);
  if (!isExecutable(cachedBin)) return false;

  const target = join(cwd, pipDir(config));
  try {
    mkdirSync(target, { recursive: true });
    cpSync(cached, target, { recursive: true });
    return isExecutable(join(cwd, pipBin(config)));
  } catch {
    return false;
  }
}

function saveToCache(cwd: string, config: PipToolConfig): void {
  const source = join(cwd, pipDir(config));
  const cached = cacheDir(config);
  try {
    mkdirSync(cached, { recursive: true });
    cpSync(source, cached, { recursive: true });
  } catch {
    // Best-effort.
  }
}

export function installPipTool(cwd: string, config: PipToolConfig): string | undefined {
  const link = join(cwd, nodeBin(config));

  if (isExecutable(link)) {
    const check = spawnSync(link, ['--version'], { encoding: 'utf8', cwd });
    const output = `${check.stdout ?? ''}${check.stderr ?? ''}`;
    if (output.includes(config.version)) return link;
  }

  if (restoreFromCache(cwd, config)) {
    writeWrapper(link, config);
    ok(`${config.binName} ${config.version} (cached) -> node_modules/.bin/${config.binName}`);
    return link;
  }

  const pythons = allPythons();
  if (pythons.length === 0) {
    error(`Python is not on PATH - cannot install ${config.binName} locally.`);
    process.stderr.write(
      `  ${dim(`Install Python, or: python3 -m pip install --target=${pipDir(config)} ${config.pipPackage}==${config.version}`)}\n`,
    );
    return undefined;
  }

  step(`Installing ${config.binName} ${config.version}`);
  const target = join(cwd, pipDir(config));
  let installed = false;
  for (const python of pythons) {
    const result = spawnSync(
      python,
      ['-m', 'pip', 'install', `--target=${target}`, `${config.pipPackage}==${config.version}`],
      { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8', cwd },
    );
    if ((result.status ?? 1) === 0) {
      installed = true;
      break;
    }
  }

  if (!installed) {
    error(`pip install failed for ${config.pipPackage}==${config.version}.`);
    process.stderr.write(`  ${dim('Upgrade pip: python3 -m pip install --upgrade pip')}\n`);
    return undefined;
  }

  const bin = join(cwd, pipBin(config));
  if (!isExecutable(bin)) {
    error(`${config.binName} binary not found at ${pipBin(config)} after install.`);
    return undefined;
  }

  saveToCache(cwd, config);
  writeWrapper(link, config);

  ok(`${config.binName} ${config.version} -> node_modules/.bin/${config.binName}`);
  return link;
}
