import type { ResolvedNode } from '@coach/pipeline';

import type { NodeCard } from '../format/format.ts';
import { fonts, monoLabel, tokens } from '../theme.ts';

const LONG_TEXT_THRESHOLD = 180;
const CLAMP_LINES = 6;
const EXPANDED_MAX_H = 240;

interface LongText {
  label: string;
  text: string;
  quote: boolean;
}

// The one long-text value worth surfacing in full: the prompt anchor's full text
// (carried on the synthesized card, which has no node), or a tool's instruction to
// its weak model (the semantic `comment`). Truncated on the card; whole here.
export function longTextOf(card: NodeCard, resolved: ResolvedNode | undefined): LongText | null {
  if (card.prompt != null) return { label: 'PROMPT', text: card.prompt, quote: false };
  const comment = resolved?.semantics?.comment;
  if (comment != null) return { label: 'INSTRUCTION TO WEAK MODEL', text: comment, quote: true };
  return null;
}

function clampStyle(long: boolean, expanded: boolean): React.CSSProperties {
  if (long && !expanded) {
    return {
      display: '-webkit-box',
      WebkitLineClamp: CLAMP_LINES,
      WebkitBoxOrient: 'vertical',
      overflow: 'hidden',
    };
  }
  return {
    maxHeight: expanded ? EXPANDED_MAX_H : undefined,
    overflowY: expanded ? 'auto' : 'visible',
  };
}

// A long value in a scrollable, height-capped block: collapsed shows ~6 lines
// with a `show full ▾` toggle, expanded scrolls. Short values skip the toggle.
export function longTextBlock(
  block: LongText,
  expanded: boolean,
  onToggle: () => void,
): React.ReactNode {
  const long = block.text.length > LONG_TEXT_THRESHOLD;
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ ...monoLabel, marginBottom: 10 }}>{block.label}</div>
      <div
        style={{
          background: tokens.surface,
          border: `1px solid ${tokens.insetBorder}`,
          borderRadius: 9,
          padding: '11px 13px',
          fontFamily: fonts.mono,
          fontSize: 11.5,
          lineHeight: 1.55,
          color: tokens.inkSoft,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          ...clampStyle(long, expanded),
        }}
      >
        {block.quote ? `“${block.text}”` : block.text}
      </div>
      {long && (
        <button
          onClick={onToggle}
          style={{
            marginTop: 7,
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            fontFamily: fonts.mono,
            fontSize: 11,
            color: tokens.accentInkSoft,
          }}
        >
          {expanded ? 'show less ▴' : 'show full ▾'}
        </button>
      )}
    </div>
  );
}
