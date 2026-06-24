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
  it('renders the expand/collapse controls but no raw-node toggle (it lives in the card)', () => {
    const markup = render();
    expect(markup).toContain('expand all');
    expect(markup).toContain('collapse all');
    expect(markup).not.toContain('raw node');
  });
});
