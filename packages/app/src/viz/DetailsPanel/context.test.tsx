import type { ResolvedNode, SemanticContext } from '@coach/pipeline';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { contextBlock } from './context.tsx';

function resolvedWith(context: SemanticContext | undefined): ResolvedNode {
  const node = { id: 'n1', type: 'tool', sessionId: 's1' } as ResolvedNode['node'];
  return {
    node,
    semantics: { what: ['read source code'], ...(context != null ? { context } : {}) },
  };
}

function markup(context: SemanticContext | undefined): string {
  return renderToStaticMarkup(<>{contextBlock(resolvedWith(context))}</>);
}

describe('contextBlock', () => {
  it('renders package, file, and url (url as a link) as labeled rows', () => {
    const html = markup({
      package: 'pipeline',
      file: 'packages/pipeline/src/index.ts',
      url: 'https://example.com/x',
    });
    expect(html).toContain('PACKAGE');
    expect(html).toContain('pipeline');
    expect(html).toContain('FILE');
    expect(html).toContain('packages/pipeline/src/index.ts');
    expect(html).toContain('URL');
    expect(html).toContain('<a');
    expect(html).toContain('href="https://example.com/x"');
  });

  it('omits fields that are absent', () => {
    const html = markup({ file: 'packages/app/src/main.tsx' });
    expect(html).toContain('FILE');
    expect(html).not.toContain('PACKAGE');
    expect(html).not.toContain('URL');
  });

  it('renders nothing when the node carries no context', () => {
    expect(markup(undefined)).toBe('');
  });
});
