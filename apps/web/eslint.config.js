// Flat ESLint config for @moneypulse/web.
//
// Next.js 16 removed the built-in `next lint` command, so the `lint` script now
// invokes eslint directly. `eslint-config-next`'s bundled scope-manager version
// is incompatible with the eslint 10.x installed here (throws
// "scopeManager.addGlobals is not a function" at lint time), so this uses
// typescript-eslint's recommended (non-type-checked) preset directly instead —
// same minimal approach already used for @moneypulse/api.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- this file itself is CommonJS
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'dist/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Downgraded to a warning: this is the first lint config this package has
      // ever had, and flipping it to an error would fail the build on
      // pre-existing files unrelated to this change.
      'prefer-const': 'warn',
    },
  },
);
