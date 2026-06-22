import { describe, expect, it } from 'vitest';

import { coarseAction, commandProgram, shellCommandAction } from './action.ts';
import { defaultSemanticsConfig } from './defaults.ts';

const config = defaultSemanticsConfig;
const coarseSet = new Set(config.ontology.coarseActions);

describe('coarseAction (ontology-action rollup, read from the ontology)', () => {
  it('rolls read/search/review up to explore', () => {
    expect(coarseAction(config, 'read')).toBe('explore');
    expect(coarseAction(config, 'search')).toBe('explore');
    expect(coarseAction(config, 'review')).toBe('explore');
  });

  it('rolls the verification family up to verify and fetch/search-web to research', () => {
    for (const id of ['lint', 'format', 'typecheck', 'verify']) {
      expect(coarseAction(config, id)).toBe('verify');
    }
    expect(coarseAction(config, 'fetch')).toBe('research');
    expect(coarseAction(config, 'search-web')).toBe('research');
    expect(coarseAction(config, 'invoke')).toBe('mcp');
  });

  it('rolls meta/harness actions up to the meta bucket, not other', () => {
    for (const id of ['load-schema', 'clarify', 'respond', 'generate-title', 'predict']) {
      expect(coarseAction(config, id)).toBe('meta');
    }
    expect(coarseAction(config, 'plan')).toBe('plan');
  });

  it('falls back to the escape action bucket for an unknown or undefined id', () => {
    // escape action is `act`, whose coarse bucket is `other`.
    expect(coarseAction(config, 'not-an-action')).toBe('other');
    expect(coarseAction(config, undefined)).toBe('other');
  });

  it('only ever returns a declared coarseActions id', () => {
    for (const a of config.ontology.actions)
      expect(coarseSet.has(coarseAction(config, a.id))).toBe(true);
  });
});

describe('shellCommandAction (ontology command grammar → ontology action id)', () => {
  it('classifies git/gh commands as vcs', () => {
    expect(shellCommandAction(config, 'git commit -m "x"')).toBe('vcs');
    expect(shellCommandAction(config, '  gh pr create')).toBe('vcs');
  });

  it('classifies test runners as test (direct and via package runner)', () => {
    expect(shellCommandAction(config, 'pytest tests/')).toBe('test');
    expect(shellCommandAction(config, 'vitest run')).toBe('test');
    expect(shellCommandAction(config, 'pnpm test')).toBe('test');
    expect(shellCommandAction(config, 'npm run test')).toBe('test');
  });

  it('classifies search commands (grep/rg/find) as search', () => {
    expect(shellCommandAction(config, 'grep -rn foo src/')).toBe('search');
    expect(shellCommandAction(config, 'rg pattern')).toBe('search');
    expect(shellCommandAction(config, 'find . -name "*.ts"')).toBe('search');
  });

  it('classifies lint/typecheck package scripts as verify and install/build as build', () => {
    expect(shellCommandAction(config, 'pnpm typecheck')).toBe('verify');
    expect(shellCommandAction(config, 'pnpm run lint')).toBe('verify');
    expect(shellCommandAction(config, 'pnpm install')).toBe('build');
    expect(shellCommandAction(config, 'make all')).toBe('build');
    expect(shellCommandAction(config, 'pip install requests')).toBe('build');
  });

  it('falls back to the grammar default (run) for an unclassified or empty command', () => {
    expect(shellCommandAction(config, 'ls -la')).toBe('run');
    expect(shellCommandAction(config, undefined)).toBe('run');
    expect(shellCommandAction(config, '')).toBe('run');
  });

  it('classifies past a leading `cd <path> &&` navigation prefix', () => {
    expect(shellCommandAction(config, 'cd packages/pipeline && git commit -m x')).toBe('vcs');
    expect(shellCommandAction(config, 'cd /tmp && pnpm test')).toBe('test');
    expect(shellCommandAction(config, 'cd src; grep -rn foo')).toBe('search');
  });

  it('a shell command rolls up through coarseAction to a coarse bucket', () => {
    expect(coarseAction(config, shellCommandAction(config, 'git push'))).toBe('vcs');
    expect(coarseAction(config, shellCommandAction(config, 'pnpm install'))).toBe('setup');
  });
});

describe('commandProgram (invoked program, for qualifying the generic run action)', () => {
  it('strips directory prefix, trailing punctuation, and a leading cd', () => {
    expect(commandProgram('python3 build.py')).toBe('python3');
    expect(commandProgram('./node_modules/.bin/tsx run.ts')).toBe('tsx');
    expect(commandProgram('cd pkg && node server.js')).toBe('node');
    expect(commandProgram(undefined)).toBe('');
  });
});
