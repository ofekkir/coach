import { defaultSemanticsConfig } from '@coach/semantics';
import { describe, expect, it } from 'vitest';

import { toolEntries } from './tool-intent.ts';

const config = defaultSemanticsConfig;

function readPhrase(filePath: string): string {
  return toolEntries(config, 'Read', { file_path: filePath })
    .map((e) => e.action)
    .join(' ');
}

describe('path object grounding under git worktrees', () => {
  it('grounds a worktree source file as source code, not agent config', () => {
    const phrase = readPhrase('/x/.claude/worktrees/foo/packages/pipeline/src/orchestrate.ts');
    expect(phrase).toContain('source code');
    expect(phrase).not.toContain('claude code config');
  });

  it('grounds a worktree top-level doc as documentation, not agent config', () => {
    const phrase = readPhrase('/x/.claude/worktrees/foo/ARCHITECTURE.md');
    expect(phrase).toContain('documentation');
    expect(phrase).not.toContain('claude code config');
  });

  it('still grounds a genuine .claude config file as agent config', () => {
    const phrase = readPhrase('/repo/.claude/hooks/lint.sh');
    expect(phrase).toContain('claude code config');
    expect(phrase).not.toContain('source code');
  });
});
