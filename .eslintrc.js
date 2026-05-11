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
  //
  // Phase 50.9.5 — `PDFKit` is the global namespace `@types/pdfkit`
  // ships for type-only references (`PDFKit.PDFDocument`,
  // `PDFKit.Mixins.TextOptions`). The base no-undef rule from
  // `eslint:recommended` doesn't understand TS namespace types and
  // flags every reference as undefined. Declaring it readonly here
  // tells ESLint the identifier is intentional.
  globals: {
    define: 'readonly',
    PDFKit: 'readonly',
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    // Disable the base no-unused-vars in favour of the TS-aware variant —
    // the base rule fires on every interface member and type-only import.
    // Underscore-prefixed names are tolerated as a deliberate intent
    // marker (common in destructuring + handler signatures).
    //
    // Phase 33: re-promoted to error after Cat-7 cleanup landed all
    // outstanding violations.
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        args: 'after-used',
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      },
    ],
    // Phase 33: re-promoted to error after Cat-7 cleanup landed.
    'no-empty': 'error',
    // Phase 33: re-promoted to error after Cat-7 cleanup landed.
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'error',
    // Still warn-only — single instance, low signal.
    'no-useless-escape': 'warn',
    'no-constant-condition': 'warn',
    // The base no-empty-pattern fires on `function foo({}: Props)` which
    // is a valid React-component signature when the props type is known
    // but no props are destructured. Allow the pattern.
    'no-empty-pattern': 'off',
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'build/',
    'coverage/',
    // Generated artifacts written by the SDF/SuiteScript generator pipeline.
    // Linting them surfaces no signal — the generator is the source of truth.
    'apps/api/outputs/',
    // Runtime-uploaded blobs (firm logos, data-collection files).
    'apps/api/uploads/',
  ],
};
