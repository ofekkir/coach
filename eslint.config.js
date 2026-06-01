// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      '.claire/**',
      '.claude/worktrees/**',
      'packages/*/dist/**',
      'src/graph/viz-dist/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // React hooks rules for the app package
  {
    files: ['packages/app/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
  // Code complexity and nesting guards.
  {
    rules: {
      'max-depth': ['error', 2],
      complexity: ['error', 10],
      'max-nested-callbacks': ['error', 2],
      'no-else-return': 'error',
    },
  },
  // Config files are plain JS and live outside the TS program; skip type-aware rules.
  {
    files: ['**/*.js'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Test files use nested describe/it/expect which is idiomatic Vitest — not a real smell.
  {
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      'max-nested-callbacks': 'off',
    },
  },
  // Forbid stray console.* — route through @coach/logger. Sanctioned escape hatch when
  // console is genuinely wanted: a per-line `// eslint-disable-next-line no-console`.
  { files: ['**/*.{ts,tsx}'], rules: { 'no-console': 'error' } },
  // Keep the Prettier compatibility layer last so it wins any formatting conflicts.
  prettier,
);
