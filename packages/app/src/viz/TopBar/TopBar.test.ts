import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { RunStats } from './stats.ts';
import { TopBar } from './TopBar.tsx';

const stats: RunStats = { breadcrumb: ['run'] };

function render(showRaw: boolean): string {
  return renderToStaticMarkup(
    createElement(TopBar, {
      title: 'demo',
      stats,
      onExpandAll: () => undefined,
      onCollapseAll: () => undefined,
      showRaw,
      onToggleShowRaw: () => undefined,
      onFocus: () => true,
    }),
  );
}

describe('TopBar raw-node toggle', () => {
  it('marks the control pressed and labels it open when raw is on', () => {
    const markup = render(true);
    expect(markup).toContain('raw node ▾');
    expect(markup).toContain('aria-pressed="true"');
  });

  it('marks the control unpressed and labels it closed when raw is off', () => {
    const markup = render(false);
    expect(markup).toContain('raw node ▸');
    expect(markup).toContain('aria-pressed="false"');
  });
});
