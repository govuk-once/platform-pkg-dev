import { describe, expect, it } from 'vitest';
import { hasCredentials, parseCredentials } from './gds.js';

describe('parseCredentials', () => {
  it('reads the export lines gds-cli emits', () => {
    const parsed = parseCredentials(
      [
        "export AWS_ACCESS_KEY_ID='ASIAEXAMPLE'",
        "export AWS_SECRET_ACCESS_KEY='wJalr/EXAMPLE+KEY'", // pragma: allowlist secret
        "export AWS_SESSION_TOKEN='FwoGZXIvYXdzEXAMPLE=='",
      ].join('\n'),
    );

    expect(parsed).toEqual({
      AWS_ACCESS_KEY_ID: 'ASIAEXAMPLE',
      AWS_SECRET_ACCESS_KEY: 'wJalr/EXAMPLE+KEY', // pragma: allowlist secret
      AWS_SESSION_TOKEN: 'FwoGZXIvYXdzEXAMPLE==',
    });
  });

  it('accepts lines with no export keyword, and double quotes', () => {
    const parsed = parseCredentials('AWS_ACCESS_KEY_ID="ASIA"\nAWS_SECRET_ACCESS_KEY=plain');

    expect(parsed['AWS_ACCESS_KEY_ID']).toBe('ASIA');
    expect(parsed['AWS_SECRET_ACCESS_KEY']).toBe('plain');
  });

  it('keeps a value that contains an equals sign', () => {
    const parsed = parseCredentials("export AWS_SESSION_TOKEN='abc==def='");
    expect(parsed['AWS_SESSION_TOKEN']).toBe('abc==def=');
  });

  it('ignores anything that is not a credential variable', () => {
    // The whole point of the allowlist: this output would otherwise change
    // what the child process is, not just who it runs as.
    const parsed = parseCredentials(
      [
        "export AWS_ACCESS_KEY_ID='ASIA'",
        "export PATH='/tmp/evil:$PATH'",
        "export NODE_OPTIONS='--require /tmp/evil.js'",
        "export AWS_PROFILE='someone-else'",
      ].join('\n'),
    );

    expect(Object.keys(parsed)).toEqual(['AWS_ACCESS_KEY_ID']);
  });

  it('cannot execute anything, however the output is shaped', () => {
    // `eval` on this would run the command substitution. Parsing keeps it a
    // string, and the key is not in the allowlist so it is dropped entirely.
    const parsed = parseCredentials('export EVIL=$(touch /tmp/pwned)\nexport AWS_ACCESS_KEY_ID=A');

    expect(parsed).toEqual({ AWS_ACCESS_KEY_ID: 'A' });
  });

  it('skips blank lines and human-readable noise', () => {
    const parsed = parseCredentials(
      ['Assuming role...', '', "export AWS_ACCESS_KEY_ID='ASIA'", 'Done.'].join('\n'),
    );

    expect(parsed).toEqual({ AWS_ACCESS_KEY_ID: 'ASIA' });
  });

  it('returns nothing for empty output', () => {
    expect(parseCredentials('')).toEqual({});
  });
});

describe('hasCredentials', () => {
  it('needs both halves of a signing key', () => {
    expect(hasCredentials({ AWS_ACCESS_KEY_ID: 'A', AWS_SECRET_ACCESS_KEY: 'B' })).toBe(true);
    expect(hasCredentials({ AWS_ACCESS_KEY_ID: 'A' })).toBe(false);
    expect(hasCredentials({})).toBe(false);
  });
});
