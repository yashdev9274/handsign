import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['.next/**', 'node_modules/**', 'extension/vendor/**', 'extension/meet.js', 'extension/recognizer.js', 'next-env.d.ts'] },
  { ...js.configs.recommended, files: ['**/*.js', '**/*.mjs'], languageOptions: { globals: {
    chrome: 'readonly', location: 'readonly', window: 'readonly', localStorage: 'readonly',
    setInterval: 'readonly', clearInterval: 'readonly', console: 'readonly', fetch: 'readonly',
    Buffer: 'readonly', URL: 'readonly'
  } } },
  ...tseslint.configs.recommended,
  { files: ['**/*.ts', '**/*.tsx'], rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } }
);
