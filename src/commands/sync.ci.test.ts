import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const gds = vi.hoisted(() => ({
  assumeRole: vi.fn(),
  authoriseCodeArtifact: vi.fn(),
  verifyCredentials: vi.fn(),
}));
vi.mock('../lib/gds.js', () => gds);

const { runSync } = await import('./sync.js');

// A `file:` spec keeps the update check offline: upgrades never apply to a local spec.
const MANIFEST = `${JSON.stringify(
  {
    name: 'ci-check',
    private: true,
    devDependencies: { '@govuk-connect/dev': 'file:../platform-pkg-dev' },
    once: { aws: { roles: { dev: 'some-role' } } },
  },
  null,
  2,
)}\n`;

describe('dev sync in a pipeline', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'dev-sync-ci-'));
    await writeFile(join(cwd, 'package.json'), MANIFEST, 'utf8');
    vi.stubEnv('CI', 'true');
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    await rm(cwd, { recursive: true, force: true });
  });

  it('reports drift without fixing it, as --check would', async () => {
    expect(await runSync([], { cwd })).toBe(1);
    expect(await readFile(join(cwd, 'package.json'), 'utf8')).toBe(MANIFEST);
  });

  it('never assumes a role or logs in to CodeArtifact', async () => {
    await runSync([], { cwd });
    expect(gds.assumeRole).not.toHaveBeenCalled();
    expect(gds.authoriseCodeArtifact).not.toHaveBeenCalled();
  });
});
