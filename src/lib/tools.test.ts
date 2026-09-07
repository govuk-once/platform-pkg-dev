import { describe, expect, it } from 'vitest';
import { inspectTool, parseVersion, toolSpecs, type ToolSpec } from './tools.js';
import { TOOL_NAMES, toolVersion } from '../versions.js';

describe('parseVersion', () => {
  it('reads the formats the three pinned tools actually print', () => {
    expect(parseVersion('pre-commit 4.5.1')).toBe('4.5.1');
    expect(parseVersion('1.174.0')).toBe('1.174.0');
    expect(parseVersion('3.3.13\n')).toBe('3.3.13');
  });

  it('skips warning lines printed before the version', () => {
    expect(parseVersion('env: python: No such file or directory\n3.3.13')).toBe('3.3.13');
  });

  it('reads a v-prefixed version without truncating it', () => {
    expect(parseVersion('v24.7.0')).toBe('24.7.0');
    expect(parseVersion('git version 2.39.5 (Apple Git-154)')).toBe('2.39.5');
  });

  it('handles two-part and pre-release versions', () => {
    expect(parseVersion('tool 1.2')).toBe('1.2');
    expect(parseVersion('tool 1.2.3-rc.1')).toBe('1.2.3-rc.1');
  });

  it('returns undefined when there is no version to read', () => {
    expect(parseVersion('command not found')).toBeUndefined();
    expect(parseVersion('')).toBeUndefined();
  });
});

describe('toolSpecs', () => {
  it('covers every tool pinned in versions.json', () => {
    expect(toolSpecs().map((spec) => spec.bin)).toEqual([...TOOL_NAMES]);
  });

  it('pins each tool to an exact version, never a range', () => {
    for (const spec of toolSpecs()) {
      expect(spec.expected, `${spec.bin} must be an exact version`).toMatch(/^\d+\.\d+(\.\d+)?$/);
      expect(spec.expected).toBe(toolVersion(spec.bin));
    }
  });

  it('offers an install hint naming the pinned version', () => {
    for (const spec of toolSpecs()) {
      expect(spec.install(spec.expected)).toContain(spec.expected);
    }
  });
});

describe('inspectTool', () => {
  const fake = (bin: string, expected: string): ToolSpec => ({
    bin,
    expected,
    why: 'test',
    install: (v) => `install ${bin}==${v}`,
  });

  it('reports missing for a binary that is not on PATH', () => {
    const status = inspectTool(fake('platform-pkg-dev-definitely-not-a-real-binary', '1.0.0'));
    expect(status.state).toBe('missing');
  });

  it('reports ok when the installed version matches the pin', () => {
    // `node` is guaranteed present: it is running this test.
    const status = inspectTool(fake('node', process.versions.node));
    expect(status.state).toBe('ok');
  });

  it('reports mismatch, and the version it found, when the pin differs', () => {
    const status = inspectTool(fake('node', '0.0.1'));
    expect(status.state).toBe('mismatch');
    if (status.state === 'mismatch') expect(status.found).toBe(process.versions.node);
  });
});
