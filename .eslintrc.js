module.exports = {
  env: {
    browser: true,
    es2021: true,
    node: true
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    'indent': ['error', 2],
    'linebreak-style': ['error', 'unix'],
    'quotes': ['error', 'single'],
    'semi': ['error', 'always'],
    'no-console': 'warn',
    'comma-dangle': ['error', 'always-multiline'],
    'max-len': ['warn', { code: 100 }],
    'object-curly-spacing': ['error', 'always']
  },
  ignorePatterns: ['node_modules/', 'dist/', 'logs/']
};
