import type { SemanticsConfig } from './config.ts';

// A compact SemanticsConfig fixture mirroring the real config/ artifacts for the
// rules the interpreter tests exercise. Kept in-package so the pure pipeline and
// its tests stay self-contained; the real JSON artifacts are validated by the
// CLI loader (assembleSemanticsConfig) when `pnpm e2e --enrich` runs.

export const testConfig: SemanticsConfig = {
  ontology: {
    id: 'coding',
    escape: { action: 'act', object: 'unknown' },
    actions: [
      { id: 'read', group: 'work', label: 'read' },
      { id: 'edit', group: 'work', label: 'edit' },
      { id: 'write', group: 'work', label: 'write' },
      { id: 'fetch', group: 'work', label: 'fetch' },
      { id: 'test', group: 'work', label: 'run tests' },
      { id: 'configure', group: 'work', label: 'configure' },
      { id: 'use-skill', group: 'meta', label: 'use skill' },
      { id: 'load-schema', group: 'harness', label: 'load tool schema' },
      { id: 'invoke', group: 'meta', label: 'invoke' },
      { id: 'plan', group: 'meta', label: 'plan next steps' },
      { id: 'respond', group: 'meta', label: 'respond' },
      { id: 'generate-title', group: 'harness', label: 'generate session title' },
      { id: 'predict', group: 'harness', label: 'predict next user prompt' },
      { id: 'run', group: 'work', label: 'run' },
      { id: 'act', group: 'escape', label: 'act' },
    ],
    objects: [
      { id: 'agent-config', label: 'agent config' },
      { id: 'business-logic', label: 'business logic' },
      { id: 'unit-test', label: 'unit test' },
      { id: 'test-code', label: 'tests' },
      { id: 'web-resource', label: 'web resource' },
      { id: 'tool', label: 'tool' },
      { id: 'task-list', label: 'task list' },
      { id: 'user', label: 'user' },
      { id: 'repo', label: 'repository' },
      { id: 'shell', label: 'shell command' },
      { id: 'unknown', label: 'unknown' },
    ],
  },
  agent: {
    id: 'claude-code',
    ontology: 'coding',
    wellKnownPaths: {
      rules: [
        { match: '/\\.claude/settings\\.json$', label: 'claude code user settings' },
        { match: '/\\.claude/', label: 'claude code config' },
      ],
    },
    tools: {
      Read: {
        action: 'read',
        target: { field: 'file_path', kind: 'path' },
        phrase: 'read {object}',
      },
      Edit: {
        action: 'edit',
        target: { field: 'file_path', kind: 'path' },
        phrase: 'edit {object}',
      },
      Write: {
        action: 'write',
        target: { field: 'file_path', kind: 'path' },
        phrase: 'write {object}',
      },
      WebFetch: {
        action: 'fetch',
        target: { field: 'url', kind: 'host' },
        phrase: 'fetch {target}',
        modifiers: [
          { when: { field: 'prompt', matches: 'summar' }, append: { label: 'summarize content' } },
        ],
      },
      ToolSearch: {
        action: 'load-schema',
        object: 'tool',
        target: { field: 'query', kind: 'literal', extract: 'select:([A-Za-z0-9_]+)' },
        phrase: 'load {target} tool schema',
        fallbackPhrase: 'load tool schema',
      },
      Skill: {
        action: 'use-skill',
        target: { field: 'skill', kind: 'literal' },
        phrase: 'use {target} skill',
        overrides: [
          {
            when: { field: 'skill', equals: 'update-config' },
            action: 'configure',
            object: 'agent-config',
            label: 'update claude code config',
          },
        ],
      },
      Bash: {
        escapeHatch: true,
        target: { field: 'command', kind: 'literal' },
        grammarRef: 'bashCommandGrammar',
      },
      _unknownTool: { action: 'act', object: 'unknown', phrase: '{toolNameLower}' },
    },
    bashCommandGrammar: {
      rules: [{ match: '.*', action: 'run', object: 'shell', label: 'run command' }],
    },
    markers: {
      rules: [
        {
          id: 'session-title',
          when: { responseJsonHasStringKey: 'title' },
          action: 'generate-title',
          object: 'repo',
        },
        {
          id: 'suggestion-mode',
          when: { requestTextStartsWith: '[SUGGESTION MODE' },
          action: 'predict',
          object: 'user',
        },
      ],
    },
    structuralRoles: {
      rules: [
        {
          id: 'thinking',
          when: { responseHasBlockType: 'thinking' },
          action: 'plan',
          phrase: 'plan next steps',
        },
        {
          id: 'tool_use',
          when: { responseEndsWithBlockType: 'tool_use' },
          action: 'invoke',
          phrase: 'invoke {toolPhrase}',
          overrides: [{ when: { toolName: 'Skill' }, phrase: 'decide on skill use' }],
        },
      ],
    },
  },
  project: {
    id: 'coach',
    ontology: 'coding',
    architecture: {
      pathRules: [
        { glob: 'packages/pipeline/**', object: 'business-logic' },
        { glob: '**/*', object: 'unknown' },
      ],
    },
    commands: {
      rules: [{ match: '^pnpm\\s+test\\b', action: 'test', object: 'test-code' }],
    },
  },
};
