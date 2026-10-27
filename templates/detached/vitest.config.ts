import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts', 'test/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/cdk.out/**', '**/coverage/**'],
    globals: false,
    environment: 'node',
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
