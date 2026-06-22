import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_GROUP, bashAction, coarseAction, type Action } from './action.ts';
import { defaultSemanticsConfig } from './defaults.ts';

describe('coarseAction (ontology-action rollup)', () => {
  it('rolls read/search/review up to explore', () => {
    expect(coarseAction('read')).toBe('explore');
    expect(coarseAction('search')).toBe('explore');
    expect(coarseAction('review')).toBe('explore');
  });

  it('rolls write to author and edit/delete/refactor to edit', () => {
    expect(coarseAction('write')).toBe('author');
    expect(coarseAction('edit')).toBe('edit');
    expect(coarseAction('delete')).toBe('edit');
    expect(coarseAction('refactor')).toBe('edit');
  });

  it('rolls the verification family up to verify', () => {
    for (const id of ['lint', 'format', 'typecheck', 'verify']) {
      expect(coarseAction(id)).toBe('verify');
    }
  });

  it('rolls fetch/search-web to research, invoke to mcp, delegate/use-skill to delegate', () => {
    expect(coarseAction('fetch')).toBe('research');
    expect(coarseAction('search-web')).toBe('research');
    expect(coarseAction('invoke')).toBe('mcp');
    expect(coarseAction('delegate')).toBe('delegate');
    expect(coarseAction('use-skill')).toBe('delegate');
  });

  it('falls back to other for an unmapped or undefined id — never NULL', () => {
    expect(coarseAction('act')).toBe('other');
    expect(coarseAction('not-an-action')).toBe('other');
    expect(coarseAction(undefined)).toBe('other');
  });

  it('only ever returns a value from the closed ACTIONS set', () => {
    const set = new Set<Action>(ACTIONS);
    for (const id of Object.values(ACTION_GROUP)) expect(set.has(id)).toBe(true);
    expect(set.has(coarseAction(undefined))).toBe(true);
  });
});

// Drift guard: the rollup must cover every action the ontology defines, so adding
// an ontology action without a coarse bucket fails CI instead of silently → other.
describe('ACTION_GROUP totality over the ontology', () => {
  it('maps every ontology action id to a coarse bucket', () => {
    const ontologyActionIds = defaultSemanticsConfig.ontology.actions.map((a) => a.id);
    const unmapped = ontologyActionIds.filter((id) => !(id in ACTION_GROUP));
    expect(unmapped).toEqual([]);
  });
});

describe('bashAction (shell command classifier)', () => {
  it('classifies git/gh commands as vcs', () => {
    expect(bashAction('git commit -m "x"')).toBe('vcs');
    expect(bashAction('  gh pr create')).toBe('vcs');
  });

  it('classifies test runners as test (direct and via package runner)', () => {
    expect(bashAction('pytest tests/')).toBe('test');
    expect(bashAction('vitest run')).toBe('test');
    expect(bashAction('pnpm test')).toBe('test');
    expect(bashAction('npm run test')).toBe('test');
  });

  it('classifies lint/typecheck package scripts as verify', () => {
    expect(bashAction('pnpm typecheck')).toBe('verify');
    expect(bashAction('pnpm run lint')).toBe('verify');
    expect(bashAction('eslint .')).toBe('run');
  });

  it('classifies install/build/make as setup', () => {
    expect(bashAction('pnpm install')).toBe('setup');
    expect(bashAction('pnpm build')).toBe('setup');
    expect(bashAction('make all')).toBe('setup');
    expect(bashAction('pip install requests')).toBe('setup');
  });

  it('falls back to run for an unclassified or empty command', () => {
    expect(bashAction('ls -la')).toBe('run');
    expect(bashAction(undefined)).toBe('run');
    expect(bashAction('')).toBe('run');
  });
});
