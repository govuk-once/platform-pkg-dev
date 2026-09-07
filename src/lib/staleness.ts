import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The platform-pkg-dev installation currently running, whether linked or installed.
 *
 * This file compiles to dist/lib/, so the package root is two levels up from
 * its directory - matching how the other modules here find package.json.
 */
export function pkgDevRoot(): string {
  return fileURLToPath(new URL('../../', import.meta.url));
}

/** Newest modification time under a directory, or undefined if it is absent. */
function newestMtime(dir: string): number | undefined {
  let newest: number | undefined;

  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      const time = statSync(path).mtimeMs;
      if (newest === undefined || time > newest) newest = time;
    }
  };

  try {
    walk(dir);
  } catch {
    return undefined;
  }

  return newest;
}

/**
 * Whether the running platform-pkg-dev has source changes that have not been compiled.
 *
 * Only meaningful for a `link:` checkout: an installed copy ships `dist` and no
 * `src`, so there is nothing to compare and this returns false. Nothing rebuilds
 * platform-pkg-dev automatically, so a linked package otherwise runs stale code
 * silently - which is a genuinely confusing way to lose an afternoon.
 */
export function isBuildStale(root: string = pkgDevRoot()): boolean {
  const src = newestMtime(join(root, 'src'));
  if (src === undefined) return false;

  const dist = newestMtime(join(root, 'dist'));
  if (dist === undefined) return true;

  return src > dist;
}
