module.exports = {
  root: true,
  extends: ['eslint:recommended'],
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  env: { node: true, es2022: true },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
  },
};
