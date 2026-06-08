// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactPlugin from 'eslint-plugin-react';
import { createFolderStructure, projectStructurePlugin } from 'eslint-plugin-project-structure';
import noBarrelFiles from 'eslint-plugin-no-barrel-files';
import sonarjs from 'eslint-plugin-sonarjs';

// TODO: projectStructureParser integration was kept minimal due to parser-layering
// complexity with typescript-eslint's projectService. The rule enforces PascalCase
// folder/entry naming but cannot require that every component live in a folder —
// only that PascalCase folders (when they exist) contain a {FolderName}.tsx entry.
// The size + no-multi-comp rules are the primary forcing functions for file splitting.

const vizStructureConfig = createFolderStructure({
  structureRoot: 'packages/app/src/viz',
  structure: [
    { name: '*' },
    {
      name: '{PascalCase}',
      children: [{ name: '{FolderName}.tsx' }, { name: '*' }],
    },
  ],
});

const uploadStructureConfig = createFolderStructure({
  structureRoot: 'packages/app/src/upload',
  structure: [
    { name: '*' },
    {
      name: '{PascalCase}',
      children: [{ name: '{FolderName}.tsx' }, { name: '*' }],
    },
  ],
});

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
  // One React component per file
  {
    files: ['packages/app/**/*.tsx'],
    plugins: { react: reactPlugin },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/no-multi-comp': ['error', { ignoreStateless: false }],
    },
  },
  // Component folder structure: only run on .tsx files in direct PascalCase subfolders.
  // Scoped to */*.tsx to exclude utility subfolders like viz/layout/*.ts.
  {
    files: ['packages/app/src/viz/*/*.tsx'],
    plugins: { 'project-structure': projectStructurePlugin },
    rules: {
      'project-structure/folder-structure': ['error', vizStructureConfig],
    },
  },
  {
    files: ['packages/app/src/upload/*/*.tsx'],
    plugins: { 'project-structure': projectStructurePlugin },
    rules: {
      'project-structure/folder-structure': ['error', uploadStructureConfig],
    },
  },
  // Magic-number policy, repo-wide: a numeric literal that carries meaning must be
  // bound to a named constant (or function) — the name IS the documentation. The
  // TS-aware @typescript-eslint variant is used so enums and numeric-literal types
  // aren't false positives. The ONLY ignored values are -1/0/1 (and bigint 0n):
  // the constants of identity, emptiness, and off-by-one/indexOf idioms, which no
  // name can clarify (`slice(0, i)`, `idx >= 0`, `i + 1`). Everything else — radixes,
  // byte-lengths, hash constants, durations — must be named. Enforced deterministically,
  // not by convention. (Base no-magic-numbers stays off to avoid double-reporting.)
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-magic-numbers': 'off',
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, '0n', 1],
          ignoreArrayIndexes: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
        },
      ],
    },
  },
  // Magic-string policy, repo-wide: a string literal repeated 3+ times must be a
  // named constant (sonarjs default threshold). This is the deterministic general
  // rule — there is no maintained "ban every string literal", and a blanket ban
  // would flag hundreds of legitimate one-off keys/props/discriminants. Repetition
  // is the tractable signal that a string carries shared meaning worth naming.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { sonarjs },
    rules: {
      'sonarjs/no-duplicate-string': 'error',
    },
  },
  // Plus a curated single-literal ban where a specific magic string must route
  // through a known constant (extended per literal as found).
  {
    files: ['packages/pipeline/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "BinaryExpression[operator='+'][left.type='Literal'][left.value='s']",
          message: "Use SPAN_ID_PREFIX from id-utils.ts instead of the magic literal 's'.",
        },
      ],
    },
  },
  // Code complexity and nesting guards + file/function size limits
  {
    rules: {
      'max-depth': ['error', 2],
      complexity: ['error', 10],
      'max-nested-callbacks': ['error', 2],
      'no-else-return': 'error',
      'max-lines': ['error', { max: 200, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 80, skipBlankLines: true, skipComments: true }],
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
      'max-lines': 'off',
      'max-lines-per-function': 'off',
      'no-magic-numbers': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      'sonarjs/no-duplicate-string': 'off',
    },
  },
  // Ban barrel files everywhere except each package's public src/index.ts.
  {
    ignores: ['**/src/index.ts'],
    plugins: { 'no-barrel-files': noBarrelFiles },
    rules: { 'no-barrel-files/no-barrel-files': 'error' },
  },
  // Forbid stray console.* — route through @coach/logger. Sanctioned escape hatch when
  // console is genuinely wanted: a per-line `// eslint-disable-next-line no-console`.
  { files: ['**/*.{ts,tsx}'], rules: { 'no-console': 'error' } },
  // Keep the Prettier compatibility layer last so it wins any formatting conflicts.
  prettier,
);
