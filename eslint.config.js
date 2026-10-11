import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'src-tauri/target/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-undef': 'off', // TypeScript handles this

      // ── 机器锁：把「靠 agent 记住」的两条禁令变成 lint 硬拦（违反即 error）
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='invoke']",
          message:
            '前端禁止直接 invoke —— 走 services/tauri/client.ts 的 invokeCommand（命令名登记在 command-names.ts）。',
        },
        {
          selector: "CallExpression[callee.property.name='replaceAll']",
          message:
            '禁止 String.replaceAll（TS target 是 ES2020）—— 用 .split(x).join(y)。',
        },
      ],
    },
  },
  {
    // client.ts 是 IPC 唯一出口，它自己必须能调 invoke
    files: ['src/services/tauri/client.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];
