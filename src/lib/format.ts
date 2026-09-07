import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TEMPLATES_ROOT } from './render.js';

/**
 * The formatter config every Once package carries.
 *
 * Generated rather than extended: oxfmt has no `extends` mechanism, so the only
 * way to keep formatting consistent across packages is for platform-pkg-dev to own the
 * file and `dev sync` to regenerate it. The editor extension reads this file
 * directly, which is why it has to exist per package rather than being passed
 * on the command line.
 */
export const FORMAT_CONFIG_FILE = '.oxfmtrc.json';

const MASTER = join('format', 'oxfmtrc.json');

/** Renders the formatter config a package should have. */
export async function renderFormatConfig(): Promise<string> {
  return await readFile(join(TEMPLATES_ROOT, MASTER), 'utf8');
}
