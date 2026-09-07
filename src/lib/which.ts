import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Resolves an executable on PATH without shelling out. Returns undefined if absent. */
export function which(bin: string): string | undefined {
  const path = process.env['PATH'];
  if (path === undefined) return undefined;

  for (const dir of path.split(delimiter)) {
    if (dir === '') continue;
    const candidate = join(dir, bin);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not here, or not executable - keep looking.
    }
  }

  return undefined;
}
