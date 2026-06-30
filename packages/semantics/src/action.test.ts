import { describe, expect, it } from 'vitest';

import { shellCommandAction } from './action.ts';
import { defaultSemanticsConfig } from './defaults.ts';

const config = defaultSemanticsConfig;

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
});
