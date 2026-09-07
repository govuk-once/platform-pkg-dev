import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reads a package's .env into a map.
 *
 * Deliberately minimal - no interpolation, no exporting into process.env, no
 * dependency. platform-pkg-dev only ever reads flags from it, and a full dotenv parser
 * would be a lot of behaviour to inherit for that.
 *
 * A missing or unreadable file is an empty map, never an error.
 */
export function readDotenv(cwd: string): Readonly<Record<string, string>> {
  let raw: string;
  try {
    raw = readFileSync(join(cwd, '.env'), 'utf8');
  } catch {
    return {};
  }

  const values: Record<string, string> = {};

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (match === null) continue;

    const key = match[1] as string;
    let value = (match[2] ?? '').trim();

    // Strip one layer of matching quotes, then any trailing comment.
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.split(' #')[0]?.trim() ?? '';
    }

    values[key] = value;
  }

  return values;
}

/** Values that mean "off" when a flag is present but disabled. */
const FALSEY = new Set(['', '0', 'false', 'no', 'off']);

/**
 * Whether a flag is set, in the environment or the package's .env.
 *
 * A real environment variable wins, so a one-off `IS_LOCAL_DEV=0 dev sync`
 * overrides the file.
 */
export function flagEnabled(name: string, cwd: string): boolean {
  const fromEnv = process.env[name];
  const value = fromEnv ?? readDotenv(cwd)[name];

  if (value === undefined) return false;
  return !FALSEY.has(value.trim().toLowerCase());
}
