import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    exclude: ['node_modules', 'dist'],
    hookTimeout: 60000,
    testTimeout: 60000,
    // E2E suites share one database and each truncates it in beforeAll — they must
    // run one file at a time. Vitest 4 removed poolOptions.forks.singleFork (it was
    // silently ignored, so suites ran in parallel, deadlocked on TRUNCATE, and wiped
    // each other's users); fileParallelism: false is the Vitest 4 equivalent.
    pool: 'forks',
    fileParallelism: false,
  },
});
