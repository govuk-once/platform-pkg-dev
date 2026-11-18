import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const childProcess = vi.hoisted(() => ({ execSync: vi.fn() }));
vi.mock('node:child_process', () => childProcess);

class Exited extends Error {
  constructor(readonly code: number | undefined) {
    super(`process.exit(${String(code)})`);
  }
}

/** Runs a lifecycle script in-process, stopping it at its process.exit. */
async function run(script: 'preinstall' | 'postinstall'): Promise<number | undefined> {
  vi.resetModules();
  try {
    await import(`../../scripts/${script}.js`);
  } catch (error) {
    if (error instanceof Exited) return error.code;
    throw error;
  }
  return undefined;
}

describe.each(['preinstall', 'postinstall'] as const)('scripts/%s.js in a pipeline', (script) => {
  let cwd: string;

  beforeEach(async () => {
    // .githooks present: the case where, outside CI, the script would act.
    cwd = await mkdtemp(join(tmpdir(), 'dev-lifecycle-'));
    await mkdir(join(cwd, '.githooks'));
    vi.stubEnv('INIT_CWD', cwd);
    vi.stubEnv('CI', 'true');
    vi.stubEnv('DEV_BOOTSTRAPPING', '');
    vi.spyOn(process, 'exit').mockImplementation((code) => {
      throw new Exited(typeof code === 'number' ? code : undefined);
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    childProcess.execSync.mockReset();
    await rm(cwd, { recursive: true, force: true });
  });

  it('exits cleanly without running the dev CLI', async () => {
    expect(await run(script)).toBe(0);
    expect(childProcess.execSync).not.toHaveBeenCalled();
  });

  it('does run the dev CLI on a developer machine', async () => {
    vi.stubEnv('CI', '');
    await run(script);
    expect(childProcess.execSync).toHaveBeenCalledTimes(1);
  });
});
