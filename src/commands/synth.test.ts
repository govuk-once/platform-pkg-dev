import { afterEach, describe, expect, it } from 'vitest';
import { resolveRole } from './synth.js';
import { summarise } from './scan.js';

const ROLES = { dev: 'connect-udp-development-admin', prod: 'connect-udp-production-admin' };

afterEach(() => {
  delete process.env['ENV'];
});

describe('resolveRole', () => {
  it('prefers an explicit --role over anything configured', () => {
    expect(resolveRole({ roles: ROLES }, { role: 'some-other-role', env: 'dev' })).toBe(
      'some-other-role',
    );
  });

  it('uses the only configured role without needing an environment', () => {
    expect(resolveRole({ roles: { dev: ROLES.dev } }, {})).toBe(ROLES.dev);
  });

  it('picks by environment when there is more than one', () => {
    expect(resolveRole({ roles: ROLES }, { env: 'prod' })).toBe(ROLES.prod);
  });

  it('falls back to ENV', () => {
    process.env['ENV'] = 'prod';
    expect(resolveRole({ roles: ROLES }, {})).toBe(ROLES.prod);
  });

  it('refuses to guess between several roles', () => {
    // Assuming the wrong account is not a mistake worth making quietly.
    expect(() => resolveRole({ roles: ROLES }, {})).toThrow();
  });

  it('rejects an environment that is not configured, and says what is', () => {
    expect(() => resolveRole({ roles: ROLES }, { env: 'staging' })).toThrow();
  });

  it('fails clearly when nothing is configured at all', () => {
    expect(() => resolveRole({}, {})).toThrow();
  });
});

describe('summarise', () => {
  it('groups failures by check, worst first', () => {
    const lines = summarise([
      { check_id: 'CKV_AWS_18', check_name: 'logging', resource: 'A', file_path: 'a.json' },
      { check_id: 'CKV_AWS_21', check_name: 'versioning', resource: 'B', file_path: 'b.json' },
      { check_id: 'CKV_AWS_18', check_name: 'logging', resource: 'C', file_path: 'c.json' },
    ]);

    // One rule failing twice should read as one heading, not two blocks.
    expect(lines[0]).toContain('CKV_AWS_18');
    expect(lines[0]).toContain('x2');
    expect(lines.filter((l) => l.includes('CKV_AWS_18  x'))).toHaveLength(1);
    expect(lines.some((l) => l.includes('CKV_AWS_21') && l.includes('x1'))).toBe(true);
  });

  it('lists every offending resource under its check', () => {
    const lines = summarise([
      { check_id: 'CKV_AWS_18', resource: 'Bucket1', file_path: 'a.json' },
      { check_id: 'CKV_AWS_18', resource: 'Bucket2', file_path: 'a.json' },
    ]);

    expect(lines.some((l) => l.includes('Bucket1'))).toBe(true);
    expect(lines.some((l) => l.includes('Bucket2'))).toBe(true);
  });

  it('is empty when there is nothing to report', () => {
    expect(summarise([])).toEqual([]);
  });
});
