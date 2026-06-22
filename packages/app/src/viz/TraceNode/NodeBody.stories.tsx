import type { Story, StoryDefault } from '@ladle/react';

import { tokens } from '../theme.ts';

import { NodeBody, type StepPalette } from './NodeBody.tsx';

export default {
  title: 'viz/TraceNode/NodeBody',
} satisfies StoryDefault;

// Neutral (non-accent, non-lane) text colors, the common case in TraceNode.
const palette: StepPalette = {
  title: tokens.ink,
  sub: tokens.inkSoft,
  model: tokens.muted,
};

// NodeBody never renders bare — it lives inside a step card. The frame mimics that
// card so spacing and truncation read as they do in the graph.
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 240,
        padding: 14,
        background: tokens.surface,
        border: `1px solid ${tokens.cardBorder}`,
        borderRadius: 10,
      }}
    >
      {children}
    </div>
  );
}

const base = {
  title: 'read file' as string | undefined,
  subtitle: undefined as string | undefined,
  model: undefined as string | undefined,
  shareOfRun: undefined as number | undefined,
  palette,
};

// Title only — a bare action step with no sub-verb, model, or timing.
export const TitleOnly: Story = () => (
  <Card>
    <NodeBody {...base} />
  </Card>
);

// The full ramp: verb, sub-verb, and model id stacked in descending weight.
export const WithSubtitleAndModel: Story = () => (
  <Card>
    <NodeBody {...base} subtitle="/etc/hosts" model="claude-opus-4-8" />
  </Card>
);

// The longest step in its interaction carries the share-of-run bar.
export const LongestStep: Story = () => (
  <Card>
    <NodeBody {...base} title="run inference" model="claude-opus-4-8" shareOfRun={0.62} />
  </Card>
);

// Overflow case: long title and subtitle must clip to one line with an ellipsis.
export const Overflow: Story = () => (
  <Card>
    <NodeBody
      {...base}
      title="invoke a tool with an extremely long descriptive name"
      subtitle="and a similarly long subtitle that should also clip rather than wrap"
      model="claude-opus-4-8"
    />
  </Card>
);
