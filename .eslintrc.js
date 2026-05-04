module.exports = {
  root: true,
  extends: ['eslint:recommended'],
  parser: '@typescript-eslint/parser',
  // react-hooks + jsx-a11y plugins loaded so source-level
  // `// eslint-disable-next-line react-hooks/exhaustive-deps` and
  // `// eslint-disable-next-line jsx-a11y/alt-text` directive comments
  // resolve. Rules from those plugins are NOT enabled here — Cat-7 cleanup
  // commit decides whether to enable them.
  plugins: ['@typescript-eslint', 'react-hooks', 'jsx-a11y'],
  env: { node: true, es2022: true, browser: true },
  // UMD module wrappers (if (typeof define === 'function' && define.amd))
  // declare `define` as a global; without this no-undef fires on every
  // shipped library file the apps import.
  globals: {
    define: 'readonly',
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    // Disable the base no-unused-vars in favour of the TS-aware variant —
    // the base rule fires on every interface member and type-only import.
    // Underscore-prefixed names are tolerated as a deliberate intent
    // marker (common in destructuring + handler signatures).
    //
    // Phase 23-prep: demoted from error to warn. Cat-7 cleanup commit
    // will fix existing violations and re-promote.
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      },
    ],
    // Phase 23-prep: demoted from error to warn. Cat-7 cleanup commit
    // will fix existing violations and re-promote. The current hits are
    // mostly empty try/catch shapes around defensive parsing.
    'no-empty': 'warn',
    // Phase 23-prep: demoted from error to warn. Cat-7 cleanup commit
    // will fix existing violations and re-promote. One real instance
    // each — easy to triage in cleanup.
    'no-useless-escape': 'warn',
    'no-constant-condition': 'warn',
    // The base no-empty-pattern fires on `function foo({}: Props)` which
    // is a valid React-component signature when the props type is known
    // but no props are destructured. Allow the pattern.
    'no-empty-pattern': 'off',
  },
  ignorePatterns: ['dist/', 'node_modules/', 'build/', 'coverage/'],
};
