import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 1. Skip during start.sh bootstrap
if (process.env.DEV_BOOTSTRAPPING) {
  process.exit(0);
}

// 2. Skip if .githooks hasn't been scaffolded yet
const cwd = process.env.INIT_CWD || process.cwd();
if (!existsSync(join(cwd, '.githooks'))) {
  process.exit(0);
}

// 3. Resolve path to dist/cli.js
const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', 'dist', 'cli.js');

// 4. Skip if the package hasn't been built yet
if (!existsSync(cliPath)) {
  process.exit(0);
}

// 5. Execute hooks install
try {
  execSync(`node "${cliPath}" hooks install`, {
    cwd,
    stdio: 'inherit',
  });
} catch {
  // Gracefully handle or ignore failure during lifecycle hooks
  process.exit(0);
}
