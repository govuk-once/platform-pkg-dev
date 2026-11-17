// platform-pkg-dev uses the same config it hands out.
import { devVitestConfig } from './dist/vitest.js';

export default devVitestConfig({
  test: {
    // `pnpm test:coverage` writes coverage/lcov.info for Sonar.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'sam/**/*.ts', 'scripts/**/*.js'],
      exclude: ['**/*.test.ts', 'sam/example/**'],
      reporter: ['text-summary', 'lcov'],
    },
  },
});
