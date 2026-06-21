import { describe, expect, it } from 'vitest';
import { ACTIONS, classifyAction, type Action } from './action.ts';

describe('classifyAction', () => {
  it('maps read/search tools to explore', () => {
    expect(classifyAction('Read')).toBe('explore');
    expect(classifyAction('Grep')).toBe('explore');
    expect(classifyAction('Glob')).toBe('explore');
  });

  it('maps Write to author and edit tools to edit', () => {
    expect(classifyAction('Write')).toBe('author');
    expect(classifyAction('Edit')).toBe('edit');
    expect(classifyAction('MultiEdit')).toBe('edit');
  });

  it('maps web tools to research, Task to delegate, plan tools to plan', () => {
    expect(classifyAction('WebFetch')).toBe('research');
    expect(classifyAction('WebSearch')).toBe('research');
    expect(classifyAction('Task')).toBe('delegate');
    expect(classifyAction('TodoWrite')).toBe('plan');
    expect(classifyAction('ExitPlanMode')).toBe('plan');
  });

  it('maps any mcp__* tool to mcp regardless of command', () => {
    expect(classifyAction('mcp__coach__query')).toBe('mcp');
    expect(classifyAction('mcp__github__create_issue', 'git status')).toBe('mcp');
  });

  it('classifies git/gh Bash commands as vcs', () => {
    expect(classifyAction('Bash', 'git commit -m "x"')).toBe('vcs');
    expect(classifyAction('Bash', '  gh pr create')).toBe('vcs');
  });

  it('classifies test runners as test (direct and via package runner)', () => {
    expect(classifyAction('Bash', 'pytest tests/')).toBe('test');
    expect(classifyAction('Bash', 'vitest run')).toBe('test');
    expect(classifyAction('Bash', 'pnpm test')).toBe('test');
    expect(classifyAction('Bash', 'npm run test')).toBe('test');
  });

  it('classifies lint/typecheck as verify', () => {
    expect(classifyAction('Bash', 'pnpm typecheck')).toBe('verify');
    expect(classifyAction('Bash', 'pnpm run lint')).toBe('verify');
    expect(classifyAction('Bash', 'eslint .')).toBe('run');
  });

  it('classifies install/build/make as setup', () => {
    expect(classifyAction('Bash', 'pnpm install')).toBe('setup');
    expect(classifyAction('Bash', 'pnpm build')).toBe('setup');
    expect(classifyAction('Bash', 'make all')).toBe('setup');
    expect(classifyAction('Bash', 'pip install requests')).toBe('setup');
  });

  it('falls back to run for an unclassified Bash command and empty command', () => {
    expect(classifyAction('Bash', 'ls -la')).toBe('run');
    expect(classifyAction('Bash')).toBe('run');
    expect(classifyAction('Bash', '')).toBe('run');
  });

  it('falls back to other for an unknown tool name', () => {
    expect(classifyAction('SomeFutureTool')).toBe('other');
    expect(classifyAction(undefined)).toBe('other');
  });

  it('only ever returns a value from the closed ACTIONS set', () => {
    const set = new Set<Action>(ACTIONS);
    const samples: ReturnType<typeof classifyAction>[] = [
      classifyAction('Read'),
      classifyAction('Bash', 'git push'),
      classifyAction('mcp__x__y'),
      classifyAction('???'),
    ];
    for (const action of samples) expect(set.has(action)).toBe(true);
  });
});
