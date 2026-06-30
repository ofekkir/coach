import type { ResolvedNode } from '@coach/pipeline';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { contextBlock } from './context.tsx';

interface TestContext {
  package?: string;
  file?: string;
  url?: string;
}

// Builds a single semantic entry carrying the grounded argument (the repo-relative
// path is `repoPath`, surfaced by the block as FILE).
function resolvedWith(context: TestContext | undefined): ResolvedNode {
  const node = { id: 'n1', type: 'tool', sessionId: 's1' } as ResolvedNode['node'];
  const entry = {
    action: 'read source code',
    ...(context?.package != null ? { package: context.package } : {}),
    ...(context?.file != null ? { repoPath: context.file } : {}),
    ...(context?.url != null ? { url: context.url } : {}),
  };
  return { node, semantics: { entries: [entry] } };
}

function markup(context: TestContext | undefined): string {
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
