// Root ESLint config — TP Manager monorepo.
// Wave 2 wires in the in-repo `@tp/eslint-plugin-tp` plugin (TASK-025) which
// provides the `require-restaurant-id` rule.

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  env: { node: true, es2022: true },
  plugins: ['@tp/tp', '@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@tp/tp/require-restaurant-id': 'error',
  },
  ignorePatterns: ['dist', 'node_modules', 'tools/eslint-plugin-tp/src/**/*.test.js'],
  overrides: [
    {
      files: ['packages/conversions/**/*.ts', 'tools/**/*.js', 'apps/aloha-worker/**/*.ts'],
      rules: {
        // Conversions is a pure math module (no Prisma), the ESLint plugin is
        // JS-only, and the Aloha worker reads migrated rows — all three are
        // out of scope for the tenant-filter rule.
        '@tp/tp/require-restaurant-id': 'off',
      },
    },
  ],
};
