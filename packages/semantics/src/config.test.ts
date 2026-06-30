import { describe, expect, it } from 'vitest';

import { assembleSemanticsConfig } from './config.ts';
import { defaultSemanticsConfig } from './defaults.ts';

describe('defaultSemanticsConfig', () => {
  it('assembles the bundled coding × claude-code pair', () => {
    expect(defaultSemanticsConfig.ontology.id).toBe('coding');
    expect(defaultSemanticsConfig.agent.id).toBe('claude-code');
    expect(defaultSemanticsConfig.ontology.conventions?.paths.rules.length).toBeGreaterThan(0);
  });

  it('resolves the agent/project ontology reference to the bundled ontology id', () => {
    expect(defaultSemanticsConfig.agent.ontology).toBe(defaultSemanticsConfig.ontology.id);
  });
});

describe('assembleSemanticsConfig', () => {
  const ontology = {
    id: 'coding',
    actions: [{ id: 'read', group: 'work', label: 'read' }],
    commands: { runners: [], tokenRules: [], taskRules: [], default: 'read' },
    objects: [{ id: 'unknown', label: 'unknown' }],
    escape: { action: 'read', object: 'unknown' },
  };
  const agent = {
    id: 'a',
    ontology: 'coding',
    tools: { Read: { action: 'read', object: 'unknown' } },
    markers: { rules: [] },
    structuralRoles: { rules: [] },
  };

  it('accepts a config whose ids all resolve against the ontology', () => {
    expect(() => assembleSemanticsConfig(ontology, agent)).not.toThrow();
  });

  it('throws when an agent references an action id absent from the ontology', () => {
    const bad = { ...agent, tools: { Read: { action: 'fly', object: 'unknown' } } };
    expect(() => assembleSemanticsConfig(ontology, bad)).toThrow(/fly/);
  });

  it('throws when an agent references an object id absent from the ontology', () => {
    const bad = { ...agent, tools: { Read: { action: 'read', object: 'spaceship' } } };
    expect(() => assembleSemanticsConfig(ontology, bad)).toThrow(/spaceship/);
  });

  it('throws when a command rule references an action absent from the ontology', () => {
    const bad = {
      ...ontology,
      commands: {
        runners: [],
        tokenRules: [{ match: ['git'], action: 'fly' }],
        taskRules: [],
        default: 'read',
      },
    };
    expect(() => assembleSemanticsConfig(bad, agent)).toThrow(/fly/);
  });
});
