import { ACCENT_SHADOW, fonts, glyphFor, isWeakModel, tokens } from '../theme.ts';
import type { NodeCard } from '../format/format.ts';
import { formatMetrics } from '../format/format.ts';
import { BG_NW, COMPACT_NW, NW } from '../layout/types.ts';
import type { TraceRFNodeData } from '../layout/types.ts';
import { Glyph } from './Glyph.tsx';
import { NodeBody, type StepPalette } from './NodeBody.tsx';

const ELLIPSIS: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const WEIGHT_BOLD = 600;
const WEIGHT_NORMAL = 400;

// A card is neutral unless the view has a reason to point at it.
type StepState = 'background' | 'accent' | 'nested' | 'neutral';

function stepStateOf(accent: boolean, lane: TraceRFNodeData['lane'], nested: boolean): StepState {
  if (lane === 'background') return 'background';
  if (accent) return 'accent';
  if (nested) return 'nested';
  return 'neutral';
}

interface FullPalette extends StepPalette {
  tag: string;
  duration: string;
}

const PALETTES: Record<StepState, FullPalette> = {
  neutral: {
    tag: tokens.faint,
    duration: tokens.muted,
    title: tokens.ink,
    sub: tokens.inkSoft,
    model: tokens.faint,
  },
  accent: {
    tag: tokens.accentInkSoft,
    duration: tokens.accent,
    title: tokens.inkBlack,
    sub: tokens.inkSoft,
    model: tokens.faint,
  },
  nested: {
    tag: '#B89B89',
    duration: tokens.muted,
    title: tokens.ink,
    sub: tokens.inkSoft,
    model: tokens.faint,
  },
  background: {
    tag: tokens.faintLane,
    duration: tokens.faintLane,
    title: tokens.muted,
    sub: tokens.faintLane,
    model: tokens.faintLane,
  },
};

function cardWidth(lane: TraceRFNodeData['lane'], compact: boolean): number {
  if (compact) return COMPACT_NW;
  return lane === 'background' ? BG_NW : NW;
}

function stepCardStyle(
  state: StepState,
  lane: TraceRFNodeData['lane'],
  compact: boolean,
): React.CSSProperties {
  const base: React.CSSProperties = {
    width: cardWidth(lane, compact),
    borderRadius: 10,
    padding: '11px 14px',
    fontFamily: fonts.sans,
    cursor: 'pointer',
    userSelect: 'none',
  };
  if (state === 'accent') {
    return {
      ...base,
      background: tokens.surface,
      border: `1.5px solid ${tokens.accent}`,
      boxShadow: ACCENT_SHADOW,
    };
  }
  if (state === 'background') {
    return { ...base, background: tokens.lane, border: '1px dashed #DDD3C2' };
  }
  if (state === 'nested') {
    return {
      ...base,
      background: tokens.accentLane,
      border: `1px solid ${tokens.accentCalloutBorder}`,
    };
  }
  return { ...base, background: tokens.surface, border: `1px solid ${tokens.cardBorder}` };
}

function modelLabel(card: NodeCard): string | undefined {
  if (card.model == null) return undefined;
  return isWeakModel(card.model) ? `${card.model} · weak model` : card.model;
}

function chevronFor(hasRFChildren: boolean, isExpanded: boolean): string | null {
  if (!hasRFChildren) return null;
  return isExpanded ? '▾' : '▸';
}

function stepHeader(
  card: NodeCard,
  palette: FullPalette,
  accent: boolean,
  nested: boolean,
  chevron: string | null,
  duration: string | null,
): React.ReactNode {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <Glyph kind={glyphFor(card.type, nested)} accent={accent} />
      <span
        style={{
          ...ELLIPSIS,
          fontFamily: fonts.mono,
          fontSize: 9.5,
          letterSpacing: '0.12em',
          color: palette.tag,
        }}
      >
        {nested ? `NESTED ${card.tag}` : card.tag}
      </span>
      {chevron != null && (
        <span style={{ fontFamily: fonts.mono, fontSize: 11, color: palette.tag, flexShrink: 0 }}>
          {chevron}
        </span>
      )}
      {duration != null && (
        <span
          style={{
            marginLeft: 'auto',
            fontFamily: fonts.mono,
            fontSize: 11,
            fontWeight: accent ? WEIGHT_BOLD : WEIGHT_NORMAL,
            color: palette.duration,
            flexShrink: 0,
          }}
        >
          {duration}
        </span>
      )}
    </div>
  );
}

// The critical-path branch of a parallel level sets its wall-clock; this names it.
function criticalNote(): React.ReactNode {
  return (
    <div
      style={{
        fontFamily: fonts.mono,
        fontSize: 8.5,
        letterSpacing: '0.08em',
        color: tokens.accentInkSoft,
        marginTop: 5,
      }}
    >
      CRITICAL PATH · SETS WALL-CLOCK
    </div>
  );
}

// A step on the spine (or background lane): glyph + mono tag + duration, then the
// verb-led body. Accent (selection, longest step, or critical branch) is the only
// color; compact branches in a wide parallel level drop the body to verb-only.
export function renderStep(data: TraceRFNodeData, selected: boolean): React.ReactNode {
  const { card, lane, nested, isLongest, shareOfRun, isExpanded, hasRFChildren } = data;
  const accent = selected || isLongest || data.critical === true;
  const compact = data.compact === true;
  const state = stepStateOf(accent, lane, nested);
  const palette = PALETTES[state];
  const { duration } = formatMetrics(card.metrics);
  const chevron = chevronFor(hasRFChildren, isExpanded);

  return (
    <div style={stepCardStyle(state, lane, compact)}>
      {stepHeader(card, palette, accent, nested, chevron, duration)}
      <NodeBody
        title={card.title}
        subtitle={compact ? undefined : card.subtitle}
        model={compact ? undefined : modelLabel(card)}
        shareOfRun={compact ? undefined : shareOfRun}
        palette={palette}
      />
      {data.critical === true && criticalNote()}
    </div>
  );
}
