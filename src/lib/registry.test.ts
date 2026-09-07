import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { latestVersion, versionSource } from './registry.js';

const ENV = 'DEV_VERSION_URL';

async function serve(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'platform-pkg-dev-version-'));
  const file = join(dir, 'VERSION');
  await writeFile(file, body, 'utf8');
  return pathToFileURL(file).href;
}

afterEach(() => {
  delete process.env[ENV];
});

describe('versionSource', () => {
  it('reads a sibling checkout when IS_LOCAL_DEV is set in .env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platform-pkg-dev-localdev-'));
    await writeFile(join(dir, '.env'), '# local\nIS_LOCAL_DEV=true\n', 'utf8');

    const source = versionSource(dir);

    expect(source?.startsWith('file:')).toBe(true);
    expect(source).toContain('platform-pkg-dev/VERSION');
    expect(source).not.toContain('<host>');
  });

  it('ignores the flag when it is explicitly switched off', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platform-pkg-dev-localdev-'));
    await writeFile(join(dir, '.env'), 'IS_LOCAL_DEV=false\n', 'utf8');

    const source = versionSource(dir);
    expect(source?.startsWith('file:')).not.toBe(true);
  });

  it('lets an explicit URL override the local-dev flag', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platform-pkg-dev-localdev-'));
    await writeFile(join(dir, '.env'), 'IS_LOCAL_DEV=1\n', 'utf8');
    process.env[ENV] = 'https://example.test/VERSION';

    expect(versionSource(dir)).toBe('https://example.test/VERSION');
  });

  it('lets a real environment variable override the .env file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'platform-pkg-dev-localdev-'));
    await writeFile(join(dir, '.env'), 'IS_LOCAL_DEV=true\n', 'utf8');
    process.env['IS_LOCAL_DEV'] = '0';

    const source = versionSource(dir);
    expect(source?.startsWith('file:')).not.toBe(true);
    delete process.env['IS_LOCAL_DEV'];
  });
});

describe('latestVersion', () => {
  it('reads a plain version file, trailing newline and all', async () => {
    process.env[ENV] = await serve('0.9.1\n');
    expect(await latestVersion('/tmp')).toBe('0.9.1');
  });

  it('tolerates a v prefix', async () => {
    process.env[ENV] = await serve('v1.2.3');
    expect(await latestVersion('/tmp')).toBe('1.2.3');
  });

  it('ignores a response that is not a version, such as an error page', async () => {
    // A proxy returning 200 with HTML must not be mistaken for a release.
    process.env[ENV] = await serve('<!doctype html><title>404</title>');
    expect(await latestVersion('/tmp')).toBeUndefined();
  });

  it('is a silent skip when the URL cannot be reached', async () => {
    process.env[ENV] = 'file:///definitely/not/here/VERSION';
    await expect(latestVersion('/tmp')).resolves.toBeUndefined();
  });

  it('does nothing while the host is still a placeholder', async () => {
    process.env[ENV] = 'https://<host>/platform-pkg-dev/VERSION';
    expect(await latestVersion('/tmp')).toBeUndefined();
  });
});
