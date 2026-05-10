import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    exclude: ['node_modules', 'dist'],
    hookTimeout: 60000,
    testTimeout: 60000,
    // E2E suites share a running NestJS app — run sequentially to avoid port conflicts
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
