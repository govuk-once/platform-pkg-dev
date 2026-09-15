import { describe, expect, it, vi, beforeEach, type Mock } from 'vitest';

vi.mock('../lib/gds.js', () => ({
  assumeRole: vi.fn(),
  authoriseCodeArtifact: vi.fn(),
  verifyCredentials: vi.fn(),
}));

vi.mock('../lib/log.js', () => ({
  bold: (s: string) => s,
  dim: (s: string) => s,
  info: vi.fn(),
  ok: vi.fn(),
  step: vi.fn(),
  fail: (msg: string) => {
    throw new Error(msg);
  },
}));

vi.mock('../versions.js', () => ({
  CODE_ARTIFACT_ACCOUNT: 904690835784,
}));

import { runAssumeRole, runCodeArtifactAuthorise } from './gds.js';
import { assumeRole, authoriseCodeArtifact, verifyCredentials } from '../lib/gds.js';
import { info } from '../lib/log.js';
import type { RunContext } from './run.js';

const CONTEXT: RunContext = { cwd: '/tmp/test' };

const FAKE_CREDENTIALS = {
  AWS_ACCESS_KEY_ID: 'ASIAEXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'wJalr/EXAMPLE+KEY', // pragma: allowlist secret
  AWS_SESSION_TOKEN: 'FwoGZXIvYXdzEXAMPLE==',
};

beforeEach(() => {
  vi.clearAllMocks();
  (assumeRole as Mock).mockReturnValue(FAKE_CREDENTIALS);
});

describe('runAssumeRole', () => {
  it('prints help and returns 0 with --help', async () => {
    expect(await runAssumeRole(['--help'], CONTEXT)).toBe(0);
  });

  it('prints help and returns 1 when no role is given', async () => {
    expect(await runAssumeRole([], CONTEXT)).toBe(1);
  });

  it('assumes the named role and returns 0', async () => {
    const code = await runAssumeRole(['connect-development-admin'], CONTEXT);

    expect(assumeRole).toHaveBeenCalledWith('connect-development-admin');
    expect(verifyCredentials).not.toHaveBeenCalled();
    expect(code).toBe(0);
  });

  it('verifies credentials when --verify is passed', async () => {
    await runAssumeRole(['connect-development-admin', '--verify'], CONTEXT);

    expect(verifyCredentials).toHaveBeenCalledWith(FAKE_CREDENTIALS);
  });

  it('prints export statements when --export is passed', async () => {
    await runAssumeRole(['connect-development-admin', '--export'], CONTEXT);

    expect(info).toHaveBeenCalledWith(expect.stringContaining('export AWS_ACCESS_KEY_ID='));
    expect(info).toHaveBeenCalledWith(expect.stringContaining('export AWS_SECRET_ACCESS_KEY='));
  });
});

describe('runCodeArtifactAuthorise', () => {
  it('prints help and returns 0 with --help', async () => {
    expect(await runCodeArtifactAuthorise(['--help'], CONTEXT)).toBe(0);
  });

  it('prints help and returns 1 when no --role is given', async () => {
    expect(await runCodeArtifactAuthorise([], CONTEXT)).toBe(1);
  });

  it('assumes, verifies, then authorises CodeArtifact', async () => {
    const code = await runCodeArtifactAuthorise(['--role', 'connect-development-admin'], CONTEXT);

    expect(assumeRole).toHaveBeenCalledWith('connect-development-admin');
    expect(verifyCredentials).toHaveBeenCalledWith(FAKE_CREDENTIALS);
    expect(authoriseCodeArtifact).toHaveBeenCalledWith(904690835784, FAKE_CREDENTIALS);
    expect(code).toBe(0);
  });
});
