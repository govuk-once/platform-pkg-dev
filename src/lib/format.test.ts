import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderFormatConfig, FORMAT_CONFIG_FILE } from './format.js';

/** Strips the JSONC header comments platform-pkg-dev's own config carries. */
const parse = (text: string): Record<string, unknown> =>
  JSON.parse(text.slice(text.indexOf('{'))) as Record<string, unknown>;

describe('the formatter config platform-pkg-dev hands out', () => {
  it('is what platform-pkg-dev formats itself with', async () => {
    const handedOut = parse(await renderFormatConfig());
    const own = parse(readFileSync(new URL('../../.oxfmtrc.json', import.meta.url), 'utf8'));

    // Every formatting option must agree, or platform-pkg-dev's own source would be
    // formatted differently from the packages it scaffolds.
    for (const [key, value] of Object.entries(handedOut)) {
      if (key === 'ignorePatterns' || key === '$schema') continue;
      expect(own[key], `${key} must match the config platform-pkg-dev hands out`).toEqual(value);
    }
  });

  it('has platform-pkg-dev ignoring at least what it tells others to ignore', async () => {
    const handedOut = parse(await renderFormatConfig())['ignorePatterns'] as string[];
    const own = parse(readFileSync(new URL('../../.oxfmtrc.json', import.meta.url), 'utf8'))[
      'ignorePatterns'
    ] as string[];

    for (const pattern of handedOut) expect(own).toContain(pattern);
  });

  it('keeps the project style rather than oxfmt defaults', async () => {
    const config = parse(await renderFormatConfig());

    // oxfmt defaults to double quotes; the existing codebase uses single.
    expect(config['singleQuote']).toBe(true);
    expect(config['semi']).toBe(true);
  });

  it('is named the file the editor extension looks for', () => {
    expect(FORMAT_CONFIG_FILE).toBe('.oxfmtrc.json');
  });
});
