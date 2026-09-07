import { spawnSync } from 'node:child_process';
import { TOOL_NAMES, toolVersion } from '../versions.js';
import { which } from './which.js';

export interface ToolSpec {
  readonly bin: string;
  /** Exact version required, from versions.json. */
  readonly expected: string;
  /** Why a Once package needs it, shown when the check fails. */
  readonly why: string;
  /** How to install or change to the pinned version. */
  readonly install: (version: string) => string;
}

const WHY: Readonly<Record<string, string>> = {
  'pre-commit': 'runs the git hook chain, and installs every hook in it',
};

const INSTALL: Readonly<Record<string, (version: string) => string>> = {
  'pre-commit': (v) => `pipx install pre-commit==${v}   (or: brew install pre-commit)`,
};

/** Every external executable platform-pkg-dev pins, built from versions.json. */
export function toolSpecs(): readonly ToolSpec[] {
  return TOOL_NAMES.map((bin) => ({
    bin,
    expected: toolVersion(bin),
    why: WHY[bin] ?? 'used by the Once git hooks',
    install: INSTALL[bin] ?? ((v: string) => `pipx install ${bin}==${v}`),
  }));
}

/**
 * Pulls a version out of `--version` output.
 *
 * The tools disagree on format - `pre-commit 4.5.1`, a bare `1.174.0`, and a
 * `v`-prefixed `v24.7.0` - and some print warnings first, so this takes the
 * first version-shaped token anywhere in the output.
 *
 * The leading lookbehind matters: without it, `v24.7.0` matches at the `7` and
 * reports `7.0`, because there is no word boundary between `v` and `24`.
 */
export function parseVersion(output: string): string | undefined {
  return /(?<![\d.])v?(\d+\.\d+(?:\.\d+)?(?:[-.][0-9A-Za-z.]+)?)/.exec(output)?.[1];
}

export type ToolStatus =
  | { readonly state: 'ok'; readonly spec: ToolSpec; readonly found: string }
  | { readonly state: 'missing'; readonly spec: ToolSpec }
  | { readonly state: 'unreadable'; readonly spec: ToolSpec }
  | { readonly state: 'mismatch'; readonly spec: ToolSpec; readonly found: string };

/** Runs `<bin> --version` and compares against the pin. */
export function inspectTool(spec: ToolSpec): ToolStatus {
  const path = which(spec.bin);
  if (path === undefined) return { state: 'missing', spec };

  const result = spawnSync(path, ['--version'], { encoding: 'utf8' });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const found = parseVersion(output);

  if (found === undefined) return { state: 'unreadable', spec };
  if (found !== spec.expected) return { state: 'mismatch', spec, found };

  return { state: 'ok', spec, found };
}

export function inspectTools(specs: readonly ToolSpec[] = toolSpecs()): readonly ToolStatus[] {
  return specs.map(inspectTool);
}
