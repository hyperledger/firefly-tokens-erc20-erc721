module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    sourceType: 'module',
  },
  plugins: [
    '@typescript-eslint/eslint-plugin',
    'eslint-plugin-import',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
  ],
  root: true,
  env: {
    node: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/require-await': 'error',
    '@typescript-eslint/strict-boolean-expressions': 'error',
    '@typescript-eslint/unbound-method': 'error',
    '@typescript-eslint/no-unsafe-call': 'warn',
    '@typescript-eslint/no-unsafe-return': 'warn',
    '@typescript-eslint/ban-types': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'warn', {
        'varsIgnorePattern': '^_',
        'argsIgnorePattern': '^_',
      },
    ],
    'import/first': 'warn',
    'import/no-duplicates': 'warn',
    'import/order': 'warn',
    'semi': ['warn', 'always'],
    'eqeqeq': 'error',
    'eol-last': 'warn',
    'no-trailing-spaces': 'warn',
  },
};
