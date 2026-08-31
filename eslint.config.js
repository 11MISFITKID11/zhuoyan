// ESLint 扁平配置（ESLint v9+ 格式）
// 琢言项目：CommonJS 后端 + 浏览器前端 + Jest 测试

const commonRules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  'no-console': 'off',
  'no-unreachable': 'error'
};

const nodeGlobals = {
  require: 'readonly', module: 'readonly', exports: 'readonly',
  __dirname: 'readonly', __filename: 'readonly',
  process: 'readonly', console: 'readonly',
  Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
  setInterval: 'readonly', clearInterval: 'readonly',
  fetch: 'readonly', AbortController: 'readonly', AbortSignal: 'readonly',
  TextDecoder: 'readonly', TextEncoder: 'readonly', URL: 'readonly',
  describe: 'readonly', it: 'readonly', test: 'readonly', expect: 'readonly', jest: 'readonly'
};

module.exports = [
  {
    files: ['server/**/*.js', 'tests/**/*.js', '*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: nodeGlobals
    },
    rules: commonRules
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...nodeGlobals,
        window: 'readonly', document: 'readonly', localStorage: 'readonly',
        navigator: 'readonly', location: 'readonly', history: 'readonly',
        FileReader: 'readonly', Blob: 'readonly', URL: 'readonly',
        MutationObserver: 'readonly', NodeFilter: 'readonly',
        alert: 'readonly', confirm: 'readonly'
      }
    },
    rules: {
      ...commonRules,
      // 前端为多 <script> 全局作用域，函数跨文件互相调用是设计如此
      'no-undef': 'off'
    }
  }
];
