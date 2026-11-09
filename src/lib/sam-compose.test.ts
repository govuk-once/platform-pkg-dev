import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';

const compose = parse(
  readFileSync(new URL('../../sam/docker-compose.yml', import.meta.url), 'utf8'),
) as { services: Record<string, { image: string }> };

describe('sam/docker-compose.yml', () => {
  // A tag can be repointed at different content; a digest cannot.
  it.each(Object.entries(compose.services))('pins %s by tag and digest', (_name, service) => {
    expect(service.image).toMatch(/^[^\s@]+:[^\s@:]+@sha256:[a-f0-9]{64}$/);
  });
});
