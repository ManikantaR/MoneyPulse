// Minimal flat ESLint config for @moneypulse/api.
//
// Uses typescript-eslint's non-type-checked "recommended" preset so `pnpm lint`
// catches real mistakes (undefined vars, etc.) without requiring a project-wide
// type-checked lint pass (slow, and a much bigger footprint than this fix needs).
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts'],
    rules: {
      // Nest/DI code and test doubles legitimately use `any` in many places
      // (mocked db clients, dynamic metadata payloads); keep the signal on real
      // mistakes rather than forcing an unrelated repo-wide typing pass here.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Downgraded to a warning: this is the first lint config this package has ever
      // had, and flipping it to an error would fail the build on pre-existing files
      // unrelated to this change. Left visible (not silenced) so it gets cleaned up
      // incrementally rather than blocking an unrelated PR.
      'prefer-const': 'warn',
    },
  },
);
