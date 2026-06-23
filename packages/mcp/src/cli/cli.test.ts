import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { bundledSkillDir, registrationLine, runInit } from './cli.ts';

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'coach-init-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir != null) rmSync(dir, { recursive: true, force: true });
  }
});

const baseOptions = { project: true, force: false, printOnly: false } as const;

describe('runInit', () => {
  it('copies the skill into <cwd>/.claude/skills with --project', () => {
    const cwd = tempDir();
    const result = runInit({ ...baseOptions, cwd });
    const expected = join(cwd, '.claude', 'skills', 'analyze-traces', 'SKILL.md');
    expect(result.installed).toBe(true);
    expect(result.skillPath).toBe(expected);
    expect(existsSync(expected)).toBe(true);
    expect(readFileSync(expected, 'utf8')).toContain('name: analyze-traces');
  });

  it('does not clobber an existing skill without --force', () => {
    const cwd = tempDir();
    const dest = join(cwd, '.claude', 'skills', 'analyze-traces');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'SKILL.md'), 'sentinel');
    const result = runInit({ ...baseOptions, cwd });
    expect(result.installed).toBe(false);
    expect(result.message).toContain('already present');
    expect(readFileSync(join(dest, 'SKILL.md'), 'utf8')).toBe('sentinel');
  });

  it('overwrites with --force', () => {
    const cwd = tempDir();
    const dest = join(cwd, '.claude', 'skills', 'analyze-traces');
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, 'SKILL.md'), 'sentinel');
    const result = runInit({ ...baseOptions, force: true, cwd });
    expect(result.installed).toBe(true);
    expect(readFileSync(join(dest, 'SKILL.md'), 'utf8')).toContain('name: analyze-traces');
  });

  it('--print-only emits the registration line and writes nothing', () => {
    const cwd = tempDir();
    const result = runInit({ ...baseOptions, printOnly: true, cwd });
    expect(result.installed).toBe(false);
    expect(result.message).toContain('claude mcp add coach');
    expect(existsSync(join(cwd, '.claude'))).toBe(false);
  });
});

describe('registrationLine', () => {
  it('points claude mcp add at the coach-mcp bin', () => {
    expect(registrationLine()).toBe('claude mcp add coach -- coach-mcp');
    expect(registrationLine('/abs/coach-mcp')).toBe('claude mcp add coach -- /abs/coach-mcp');
  });
});

describe('bundledSkillDir', () => {
  it('resolves to a directory containing the shipped SKILL.md', () => {
    expect(existsSync(join(bundledSkillDir(), 'SKILL.md'))).toBe(true);
  });
});
