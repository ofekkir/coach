import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { NodeCard } from '../format/format.ts';
import type { TraceRFNodeData } from '../layout/types.ts';

import { renderStep } from './step.tsx';

// renderStep returns a ReactNode tree; rendering it to static HTML lets us assert
// the rendered DOM in the node-environment vitest setup without jsdom.
function html(card: NodeCard): string {
  const data: TraceRFNodeData = {
    kind: 'member',
    card,
    lane: 'main',
    nested: false,
    isLongest: false,
    hasRFChildren: false,
    isExpanded: false,
    selected: false,
  };
  return renderToStaticMarkup(renderStep(data, false) as ReactElement);
}

const okCard: NodeCard = {
  type: 'action',
  tag: 'ACTION · READ',
  title: 'reads file',
  fields: [],
  metrics: {},
};
const errorCard: NodeCard = {
  type: 'action',
  tag: 'ACTION · EDIT',
  title: 'edits config',
  fields: [],
  metrics: {},
  error: { kind: 'invalid_args', message: 'String to replace not found in file' },
};

describe('renderStep error affordance', () => {
  it('marks a failed tool node with the data-error flag and an ERROR badge', () => {
    const markup = html(errorCard);
    expect(markup).toContain('data-error="true"');
    expect(markup).toContain('ERROR');
  });

  it('does NOT mark a successful tool node', () => {
    const markup = html(okCard);
    expect(markup).not.toContain('data-error');
    expect(markup).not.toContain('ERROR');
  });
});
