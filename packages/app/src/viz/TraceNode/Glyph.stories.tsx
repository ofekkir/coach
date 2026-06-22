import type { Story, StoryDefault } from '@ladle/react';

import { tokens, type GlyphKind } from '../theme.ts';

import { Glyph } from './Glyph.tsx';

export default {
  title: 'viz/TraceNode/Glyph',
} satisfies StoryDefault;

const KINDS: GlyphKind[] = [
  'diamond-filled',
  'circle-filled',
  'circle-ring',
  'dot-halo',
  'circle-hollow',
  'square-filled',
  'diamond-hollow',
];

// Pick a shape and toggle the accent from the controls panel — the interactive
// case for eyeballing one glyph in isolation.
export const Playground: Story<{ kind: GlyphKind; accent: boolean }> = ({ kind, accent }) => (
  <Glyph kind={kind} accent={accent} />
);
Playground.args = { kind: 'circle-hollow', accent: false };
Playground.argTypes = {
  kind: { options: KINDS, control: { type: 'select' } },
};

// The full set, neutral (left) beside accent (right), as it reads across node
// roles — the regression view that catches a shape or color drifting.
export const AllVariants: Story = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, max-content)', gap: 28 }}>
    {KINDS.map((kind) => (
      <div
        key={kind}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}
      >
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <Glyph kind={kind} accent={false} />
          <Glyph kind={kind} accent />
        </div>
        <code style={{ fontFamily: 'monospace', fontSize: 11, color: tokens.muted }}>{kind}</code>
      </div>
    ))}
  </div>
);
