// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['coverage/**', 'dist/**', 'node_modules/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unnecessary-condition': 'off',
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-lines-per-function': ['error', { max: 60, skipComments: true, skipBlankLines: true }],
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // Layering, enforced a second time at the editor level. The authoritative
    // check is `npm run validate:arch`, which also catches dynamic imports.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/application/*', '@/adapters/*', '@/composition/*'], message: 'The domain layer must not depend on outer layers.' },
            { group: ['node:*'], message: 'The domain layer must stay free of platform APIs.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/application/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@/adapters/*', '@/composition/*'], message: 'The application layer talks to ports, never to adapters.' },
          ],
        },
      ],
    },
  },
  {
    files: ['src/main.ts', 'src/adapters/inbound/http/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Validators and hooks are plain Node ESM, deliberately outside the TS
    // project so they run with no build step and no dependencies. Type-aware
    // rules cannot apply to them, so turn that machinery off here rather than
    // dragging them into tsconfig just to satisfy the linter.
    files: ['**/*.mjs', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'max-lines-per-function': 'off',
      complexity: ['error', 15],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
);
