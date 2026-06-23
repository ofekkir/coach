import type { ResolvedNode } from '@coach/pipeline';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { NodeCard } from '../format/format.ts';

import { DetailsPanel } from './DetailsPanel.tsx';

function render(card: NodeCard, resolved: ResolvedNode | undefined): string {
  return renderToStaticMarkup(
    createElement(DetailsPanel, {
      card,
      resolved,
      isLongest: false,
      hiddenSubCall: undefined,
      nested: false,
      onClose: () => undefined,
    }),
  );
}

const errorNode: ResolvedNode = {
  node: {
    id: 'ed',
    type: 'tool',
    sessionId: 'session-s-1',
    name: 'Edit',
    is_error: true,
    error_kind: 'invalid_args',
    error_message: 'String to replace not found in file',
    start_time_ns: '0',
    end_time_ns: '1',
    duration_ms: 5,
  },
};

const errorCard: NodeCard = {
  type: 'action',
  tag: 'ACTION · EDIT',
  title: 'edits config',
  fields: [],
  metrics: { durationMs: 5 },
  error: { kind: 'invalid_args', message: 'String to replace not found in file' },
};

describe('DetailsPanel error section', () => {
  it('surfaces the failure, error_kind, and error_message text', () => {
    const markup = render(errorCard, errorNode);
    expect(markup).toContain('data-error-callout');
    expect(markup).toContain('FAILED');
    expect(markup).toContain('invalid_args');
    expect(markup).toContain('String to replace not found in file');
  });

  it('omits the error callout for a node without an error', () => {
    const okCard: NodeCard = {
      type: 'action',
      tag: 'ACTION · READ',
      title: 'reads file',
      fields: [],
      metrics: {},
    };
    const okNode: ResolvedNode = {
      node: {
        id: 'rd',
        type: 'tool',
        sessionId: 'session-s-1',
        name: 'Read',
        is_error: false,
        start_time_ns: '0',
        end_time_ns: '1',
        duration_ms: 5,
      },
    };
    const markup = render(okCard, okNode);
    expect(markup).not.toContain('data-error-callout');
    expect(markup).not.toContain('FAILED');
  });
});
