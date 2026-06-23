import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { HighlightRole } from '../highlight/highlight.ts';
import type { TraceRFNodeData } from '../layout/types.ts';

import { renderStep } from './step.tsx';

// renderStep returns a ReactNode tree; rendering it to static HTML lets us assert
// the rendered DOM in the node-environment vitest setup without jsdom.
function html(role: HighlightRole | undefined): string {
  const data: TraceRFNodeData = {
    kind: 'member',
    card: { type: 'action', tag: 'ACTION · READ', title: 'reads file', fields: [], metrics: {} },
    lane: 'main',
    nested: false,
    isLongest: false,
    hasRFChildren: false,
    isExpanded: false,
    selected: false,
    ...(role != null ? { highlightRole: role } : {}),
  };
  return renderToStaticMarkup(renderStep(data, false) as ReactElement);
}

describe('renderStep pair highlight', () => {
  it('marks a SOURCE node with data-role=source and a SRC badge', () => {
    const markup = html('source');
    expect(markup).toContain('data-role="source"');
    expect(markup).toContain('SRC');
    expect(markup).not.toContain('DST');
  });

  it('marks a DEST node with data-role=dest and a DST badge', () => {
    const markup = html('dest');
    expect(markup).toContain('data-role="dest"');
    expect(markup).toContain('DST');
    expect(markup).not.toContain('SRC');
  });

  it('leaves a non-highlighted node with neither role marker nor badge', () => {
    const markup = html(undefined);
    expect(markup).not.toContain('data-role');
    expect(markup).not.toContain('data-highlight-badge');
    expect(markup).not.toContain('SRC');
    expect(markup).not.toContain('DST');
  });
});
