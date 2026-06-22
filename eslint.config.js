// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactPlugin from 'eslint-plugin-react';
import { createFolderStructure, projectStructurePlugin } from 'eslint-plugin-project-structure';
import noBarrelFiles from 'eslint-plugin-no-barrel-files';
import sonarjs from 'eslint-plugin-sonarjs';
import importX from 'eslint-plugin-import-x';
// Why: the two custom rules below (comment policy + named-literal policy) live in a
// sibling module so this config stays under its own max-lines budget; their rationale
// is documented there.
import { commentPolicyPlugin, namedLiteralPlugin } from './eslint-local-rules.js';

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
  // Correctness + consistency rules not covered by the strict presets.
  // - eqeqeq bans loose equality EXCEPT against null, preserving the idiomatic
  //   `x == null` nullish check (matches null and undefined) used throughout.
  // - switch-exhaustiveness-check forces every discriminated-union switch to
  //   handle all variants — adding a node kind becomes a lint error, not a silent miss.
  // - consistent-type-imports gives an autofix for what verbatimModuleSyntax only
  //   errors on at typecheck time, so the lint-staged hook fixes it on save.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      '@typescript-eslint/switch-exhaustiveness-check': [
        'error',
        { considerDefaultExhaustiveForUnions: true },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  // Import hygiene: catch circular imports (the failure mode barrel-banning is meant
  // to prevent but can still slip through direct imports) and keep import blocks
  // deterministically ordered to minimize diff noise.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [importX.createNodeResolver()],
    },
    rules: {
      'import-x/no-cycle': 'error',
      'import-x/order': [
        'error',
        { 'newlines-between': 'always', alphabetize: { order: 'asc', caseInsensitive: true } },
      ],
    },
  },
  // Explicit return/argument types on published package boundaries: an internal type
  // change can't silently widen a package's public contract. Scoped to the public
  // entrypoints (inference stays the default everywhere internal).
  {
    files: ['packages/*/src/index.ts'],
    rules: {
      '@typescript-eslint/explicit-module-boundary-types': 'error',
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
  // Comment policy: only `Why:`-marked non-obvious WHY comments survive; a WHAT-comment
  // must become a name instead. JSDoc and tooling directives are exempt (see plugin
  // above). Placed before the test override so tests can switch it off (last-wins).
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'comment-policy': commentPolicyPlugin },
    rules: { 'comment-policy/why-marker-only': 'error' },
  },
  // Named-literal policy: enum-like string-literal unions (4+ members) must be named
  // constants (see plugin). Before the test override so tests can switch it off.
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'named-literal': namedLiteralPlugin },
    rules: { 'named-literal/name-union-members': 'error' },
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
      'comment-policy/why-marker-only': 'off',
      'named-literal/name-union-members': 'off',
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
