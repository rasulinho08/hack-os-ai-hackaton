/**
 * ESLint (flat config, ESLint 9+): `npm run lint`.
 *
 * Kept to rules that catch real mistakes — an undefined name, an unused
 * variable, an unreachable branch — without a style debate. Node globals are
 * listed here so the config needs no extra packages.
 */

const NODE_GLOBALS = Object.fromEntries([
  'require', 'module', 'exports', '__dirname', '__filename', 'process', 'console', 'Buffer',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate',
  'URL', 'URLSearchParams', 'fetch', 'AbortSignal', 'AbortController', 'TextEncoder', 'TextDecoder',
  'structuredClone', 'queueMicrotask', 'Intl', 'globalThis', 'Response', 'Request', 'Headers', 'FormData', 'Blob',
].map((name) => [name, 'readonly']));

module.exports = [
  {
    files: ['**/*.js'],
    ignores: ['node_modules/**'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: NODE_GLOBALS },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-duplicate-case': 'error',
      'no-self-assign': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-func-assign': 'error',
      'no-const-assign': 'error',
      'no-redeclare': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
    },
  },
];
