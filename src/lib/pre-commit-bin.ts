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
import { toolVersion } from '../versions.js';
import { which } from './which.js';
import { ok, step, error, dim } from './log.js';

const PIP_DIR = 'node_modules/.pip/pre-commit';
const PIP_BIN = join(PIP_DIR, 'bin', 'pre-commit');
const NODE_BIN = join('node_modules', '.bin', 'pre-commit');

function cacheDir(version: string): string {
  return join(homedir(), '.gds-dev', 'cache', 'pre-commit', version);
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
        // Not here — keep looking.
      }
    }
  }
  return result;
}

function isExecutable(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolvePreCommit(cwd: string): string | undefined {
  const local = join(cwd, NODE_BIN);
  if (isExecutable(local)) return local;
  return which('pre-commit');
}

function writeWrapper(link: string): void {
  try {
    unlinkSync(link);
  } catch {
    // Not there yet — fine.
  }
  mkdirSync(join(link, '..'), { recursive: true });

  const wrapper = [
    '#!/bin/sh',
    'DIR="$(cd "$(dirname "$0")/.." && pwd)"',
    `PYTHONPATH="$DIR/.pip/pre-commit" exec "$DIR/.pip/pre-commit/bin/pre-commit" "$@"`,
    '',
  ].join('\n');
  writeFileSync(link, wrapper, 'utf8');
  chmodSync(link, 0o755);
}

function restoreFromCache(version: string, cwd: string): boolean {
  const cached = cacheDir(version);
  const cachedBin = join(cached, 'bin', 'pre-commit');
  if (!isExecutable(cachedBin)) return false;

  const target = join(cwd, PIP_DIR);
  try {
    mkdirSync(target, { recursive: true });
    cpSync(cached, target, { recursive: true });
    return isExecutable(join(cwd, PIP_BIN));
  } catch {
    return false;
  }
}

function saveToCache(version: string, cwd: string): void {
  const source = join(cwd, PIP_DIR);
  const cached = cacheDir(version);
  try {
    mkdirSync(cached, { recursive: true });
    cpSync(source, cached, { recursive: true });
  } catch {
    // Cache write is best-effort — don't block the install.
  }
}

export function installPreCommit(cwd: string): string | undefined {
  const version = toolVersion('pre-commit');
  const link = join(cwd, NODE_BIN);

  if (isExecutable(link)) {
    const check = spawnSync(link, ['--version'], { encoding: 'utf8', cwd });
    const output = `${check.stdout ?? ''}${check.stderr ?? ''}`;
    if (output.includes(version)) return link;
  }

  if (restoreFromCache(version, cwd)) {
    writeWrapper(link);
    ok(`pre-commit ${version} (cached) -> node_modules/.bin/pre-commit`);
    return link;
  }

  const pythons = allPythons();
  if (pythons.length === 0) {
    error('Python is not on PATH — cannot install pre-commit locally.');
    process.stderr.write(
      `  ${dim(`Install Python, or manually: python3 -m pip install --target=${PIP_DIR} pre-commit==${version}`)}\n`,
    );
    return undefined;
  }

  step(`Installing pre-commit ${version}`);
  const target = join(cwd, PIP_DIR);
  let installed = false;
  for (const python of pythons) {
    const result = spawnSync(
      python,
      ['-m', 'pip', 'install', `--target=${target}`, `pre-commit==${version}`],
      {
        stdio: ['ignore', 'ignore', 'pipe'],
        encoding: 'utf8',
        cwd,
      },
    );
    if ((result.status ?? 1) === 0) {
      installed = true;
      break;
    }
  }

  if (!installed) {
    error(
      'pip install failed — no Python on this machine has a pip new enough for pre-commit ' +
        version +
        '.',
    );
    process.stderr.write(`  ${dim('Upgrade pip: python3 -m pip install --upgrade pip')}\n`);
    return undefined;
  }

  const pipBin = join(cwd, PIP_BIN);
  if (!isExecutable(pipBin)) {
    error(`pre-commit binary not found at ${PIP_BIN} after install.`);
    return undefined;
  }

  saveToCache(version, cwd);
  writeWrapper(link);

  ok(`pre-commit ${version} -> node_modules/.bin/pre-commit`);
  return link;
}
