// ════════════════════════════════════════════════════════════════════════════
// The single source of truth for the warm / humane / low-saturation graph system.
// Structure (not color) encodes role; the lone clay accent is spent only on the
// node that matters — selection, the prompt anchor, the longest/critical step.
// Replaces the old per-node-type rainbow (`TYPE_COLORS` / `TYPE_FILLS`): a card is
// neutral unless it is selected or the longest step in its interaction.
// ════════════════════════════════════════════════════════════════════════════

export const tokens = {
  paper: '#F1ECE3', // graph canvas background (the dotted field)
  pageBg: '#EFEAE1', // app page background behind the frame
  frameBg: '#F4F0E8', // the framed app body behind the canvas/panel
  surface: '#FFFFFF', // step cards, panels
  surfaceWarm: '#FCFAF6', // top bar, details panel
  banner: '#FBF8F2', // level banners
  inset: '#F3EFE8', // dimmed inset
  lane: '#F4EFE7', // dimmed background-lane cards
  line: '#E7E0D5', // hairline borders
  lineStrong: '#D8CFC0', // frame border, stronger dividers
  cardBorder: '#E4DCCD', // step card border
  ink: '#2B2722', // primary text / "deed" glyphs
  inkBlack: '#221F1A', // headings
  inkSoft: '#4A443C', // secondary text / glyph strokes
  inkValue: '#3B362E', // banner value text
  muted: '#8C8579', // meta text
  faint: '#A89F8F', // type tags, axis labels
  faintLane: '#B4AB99', // background-lane meta
  dot: '#E0D8C8', // canvas dot grid
  spine: '#D3CAB9', // the rail
  connector: '#CFC6B6', // neutral edges
  slash: '#C9C0B0', // breadcrumb separators
  // ── the one accent, held in reserve ──
  accent: '#C06A43', // focus: selection, prompt anchor, longest/critical node
  accentInk: '#9C4F2C', // accent-on-light text
  accentInkSoft: '#B0673F', // softer accent text (tags)
  accentBg: '#F6E7DD', // accent tint fill
  accentBorder: '#E3C3B0', // accent tint border / sub-rail
  accentRing: '#F1DCCF', // the 3px selection ring
  accentLane: '#FCF6F1', // nested weak-model card fill
  accentCallout: '#FCF4EE', // hidden-sub-call callout fill
  accentCalloutBorder: '#EAD3C5',
  positive: '#5B8C6E', // "carries over" check marks only
  // ── failure: a failed tool call (is_error) — the only red in the system ──
  danger: '#B23A2E', // failed-step border + error glyph/tag
  dangerInk: '#8E2C22', // error text on light
  dangerBg: '#F7E3DF', // error callout fill / glyph backdrop
  dangerBorder: '#E6B8AF', // error callout border
  dangerRing: '#F3D6CF', // 3px ring on a failed node card
  // ── inset surfaces, dividers, and one-off skins (warm system) ──
  insetBorder: '#EAE2D4', // border on inset value blocks (metric cards, long-text)
  divider: '#EDE6DA', // details-panel header/footer hairline
  shareTrack: '#EFE6DB', // share-of-run bar track (behind the accent fill)
  bandFill: '#EAE3D6', // parallel-level band backdrop
  bandBorder: '#DAD0BF', // parallel-level band dashed border
  bgDash: '#DDD3C2', // background-lane card dashed border
  nestedTag: '#B89B89', // nested step's mono tag text
  calloutInk: '#6E4B3A', // hidden-sub-call callout body text
} as const;

export const fonts = {
  sans: "'Instrument Sans', system-ui, -apple-system, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', monospace",
} as const;

// ── shared style primitives ──────────────────────────────────────────────────
// Single-line truncation, spread into any text node that must not wrap.
export const ellipsis: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

// The faint mono micro-label that captions details-panel sections.
export const monoLabel: React.CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: 9.5,
  letterSpacing: '0.13em',
  color: tokens.faintLane,
};

// The 3px ring + soft drop a node wears when it is selected or the longest step.
export const ACCENT_SHADOW = `0 0 0 3px ${tokens.accentRing}, 0 4px 14px -6px rgba(160,90,50,0.3)`;

// ── Structure encodes role ────────────────────────────────────────────────────
// A small CSS shape replaces the colored badge. `inference` reads as a hollow
// mark ("a thought"); `action` as a filled mark ("a deed"); levels as solid
// fills; the prompt anchor and nested weak-model call wear the accent.
export type GlyphKind =
  | 'diamond-filled' // agent
  | 'circle-filled' // session
  | 'circle-ring' // interaction
  | 'dot-halo' // user_prompt (accent)
  | 'circle-hollow' // inference (incl. fork/join)
  | 'square-filled' // action
  | 'diamond-hollow'; // nested / weak-model inference (accent)

const CIRCLE_HOLLOW: GlyphKind = 'circle-hollow';
const SQUARE_FILLED: GlyphKind = 'square-filled';

const GLYPH_BY_TYPE: Record<string, GlyphKind> = {
  agent: 'diamond-filled',
  session: 'circle-filled',
  interaction: 'circle-ring',
  user_prompt: 'dot-halo',
  llm_request: CIRCLE_HOLLOW,
  inference: CIRCLE_HOLLOW,
  tool: SQUARE_FILLED,
  action: SQUARE_FILLED,
  'tool.execution': SQUARE_FILLED,
  hook: SQUARE_FILLED,
};

export function glyphFor(type: string, nested = false): GlyphKind {
  if (nested) return 'diamond-hollow';
  return GLYPH_BY_TYPE[type] ?? CIRCLE_HOLLOW;
}

export type Role = 'banner' | 'anchor' | 'step';

const ROLE_BY_TYPE: Record<string, Role> = {
  agent: 'banner',
  session: 'banner',
  user_prompt: 'anchor',
};

export function roleFor(type: string): Role {
  return ROLE_BY_TYPE[type] ?? 'step';
}

// Whether a model id denotes a weak/secondary model. Display heuristic only — the
// pipeline carries no such flag; the gap between a tool's wall-clock and the weak
// model running inside it is a coach signal worth surfacing.
export function isWeakModel(model: string | undefined): boolean {
  return model != null && /haiku/i.test(model);
}
