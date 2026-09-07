import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { flagEnabled } from './env.js';
import { VERSION_URL } from '../versions.js';

/** Set in a package's .env to develop against a sibling platform-pkg-dev checkout. */
export const LOCAL_DEV_FLAG = 'IS_LOCAL_DEV';

/** Where the sibling checkout's version file is expected to be. */
export const LOCAL_VERSION_PATH = '../platform-pkg-dev/VERSION';

/** Anything that is not a version string - an error page, a redirect stub. */
const VERSION_PATTERN = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Reads the body at a URL. `file:` is handled directly because fetch does not
 * support it, and it is how this gets exercised without a server.
 */
async function read(url: string, timeoutMs: number): Promise<string | undefined> {
  if (url.startsWith('file:')) return await readFile(fileURLToPath(url), 'utf8');

  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { accept: 'text/plain' },
  });

  return response.ok ? await response.text() : undefined;
}

/**
 * Fetches the latest published platform-pkg-dev version.
 *
 * Deliberately a plain-text file rather than the npm registry: platform-pkg-dev is
 * served from wherever start.sh is, which need not be npm at all. The file
 * contains nothing but the version.
 *
 * Returns undefined on any failure - offline, proxied, no such file, or no URL
 * configured. A version check must never be the reason `dev sync` fails, so
 * every error path here is a silent skip.
 */
export function versionSource(cwd: string): string | undefined {
  // An explicit override wins over everything, including the local-dev flag.
  const override = process.env['DEV_VERSION_URL'];
  if (override !== undefined && override !== '') return override;

  // Developing against a sibling platform-pkg-dev checkout: read its VERSION file
  // rather than asking a host what the released version is, which is a
  // different question with a different answer.
  if (flagEnabled(LOCAL_DEV_FLAG, cwd)) {
    return pathToFileURL(resolve(cwd, LOCAL_VERSION_PATH)).href;
  }

  const configured = VERSION_URL;
  if (configured === undefined || configured === '' || configured.includes('<host>')) {
    return undefined;
  }

  return configured;
}

export async function latestVersion(
  cwd: string,
  options: { timeoutMs?: number } = {},
): Promise<string | undefined> {
  const url = versionSource(cwd);
  if (url === undefined) return undefined;

  try {
    const body = (await read(url, options.timeoutMs ?? 3000))?.trim();
    if (body === undefined) return undefined;

    // Guard against a 200 that is actually an HTML error page.
    return VERSION_PATTERN.test(body) ? body.replace(/^v/, '') : undefined;
  } catch {
    return undefined;
  }
}
