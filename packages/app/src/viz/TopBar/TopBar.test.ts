import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RunStats } from './stats.ts';
import { TopBar } from './TopBar.tsx';

const stats: RunStats = { breadcrumb: ['run'] };

function render(): string {
  return renderToStaticMarkup(
    createElement(TopBar, {
      title: 'demo',
      stats,
      onCollapseAll: () => undefined,
      onFocus: () => true,
    }),
  );
}

describe('TopBar', () => {
  it('renders the collapse-all control but neither the expand-all control nor the raw-node toggle (both removed from the TopBar)', () => {
    const markup = render();
    expect(markup).toContain('collapse all');
    expect(markup).not.toContain('expand all');
    expect(markup).not.toContain('raw node');
  });
});
