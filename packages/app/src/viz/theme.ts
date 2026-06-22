// Why: the single source of truth for the warm / humane / low-saturation graph
// system. Structure (not color) encodes role; the lone clay accent is spent only on
// the node that matters — selection, the prompt anchor, the longest/critical step. A
// card stays neutral unless it is selected or the longest step in its interaction.

export const tokens = {
  paper: '#F1ECE3',
  pageBg: '#EFEAE1',
  frameBg: '#F4F0E8',
  surface: '#FFFFFF',
  surfaceWarm: '#FCFAF6',
  banner: '#FBF8F2',
  inset: '#F3EFE8',
  lane: '#F4EFE7',
  line: '#E7E0D5',
  lineStrong: '#D8CFC0',
  cardBorder: '#E4DCCD',
  ink: '#2B2722',
  inkBlack: '#221F1A',
  inkSoft: '#4A443C',
  inkValue: '#3B362E',
  muted: '#8C8579',
  faint: '#A89F8F',
  faintLane: '#B4AB99',
  dot: '#E0D8C8',
  spine: '#D3CAB9',
  connector: '#CFC6B6',
  slash: '#C9C0B0',
  accent: '#C06A43',
  accentInk: '#9C4F2C',
  accentInkSoft: '#B0673F',
  accentBg: '#F6E7DD',
  accentBorder: '#E3C3B0',
  accentRing: '#F1DCCF',
  accentLane: '#FCF6F1',
  accentCallout: '#FCF4EE',
  accentCalloutBorder: '#EAD3C5',
  positive: '#5B8C6E',
  insetBorder: '#EAE2D4',
  divider: '#EDE6DA',
  shareTrack: '#EFE6DB',
  bandFill: '#EAE3D6',
  bandBorder: '#DAD0BF',
  bgDash: '#DDD3C2',
  nestedTag: '#B89B89',
  calloutInk: '#6E4B3A',
} as const;

export const fonts = {
  sans: "'Instrument Sans', system-ui, -apple-system, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, 'SF Mono', monospace",
} as const;

export const ellipsis: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export const monoLabel: React.CSSProperties = {
  fontFamily: fonts.mono,
  fontSize: 9.5,
  letterSpacing: '0.13em',
  color: tokens.faintLane,
};

// Why: the 3px ring + soft drop a node wears when it is selected or the longest step.
export const ACCENT_SHADOW = `0 0 0 3px ${tokens.accentRing}, 0 4px 14px -6px rgba(160,90,50,0.3)`;

// Why: a small CSS shape replaces the colored badge — the INFERENCE shape reads as a
// thought, the ACTION shape as a deed; the prompt anchor and nested weak-model call
// wear the accent. Each kind is named by the role it marks, not by its shape.
const AGENT_GLYPH = 'diamond-filled';
const SESSION_GLYPH = 'circle-filled';
const INTERACTION_GLYPH = 'circle-ring';
const PROMPT_GLYPH = 'dot-halo';
const INFERENCE_GLYPH = 'circle-hollow';
const ACTION_GLYPH = 'square-filled';
const NESTED_GLYPH = 'diamond-hollow';

export type GlyphKind =
  | typeof AGENT_GLYPH
  | typeof SESSION_GLYPH
  | typeof INTERACTION_GLYPH
  | typeof PROMPT_GLYPH
  | typeof INFERENCE_GLYPH
  | typeof ACTION_GLYPH
  | typeof NESTED_GLYPH;

const GLYPH_BY_TYPE: Record<string, GlyphKind> = {
  agent: AGENT_GLYPH,
  session: SESSION_GLYPH,
  interaction: INTERACTION_GLYPH,
  user_prompt: PROMPT_GLYPH,
  llm_request: INFERENCE_GLYPH,
  inference: INFERENCE_GLYPH,
  tool: ACTION_GLYPH,
  action: ACTION_GLYPH,
  'tool.execution': ACTION_GLYPH,
  hook: ACTION_GLYPH,
};

export function glyphFor(type: string, nested = false): GlyphKind {
  if (nested) return NESTED_GLYPH;
  return GLYPH_BY_TYPE[type] ?? INFERENCE_GLYPH;
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

// Why: display heuristic only — the pipeline carries no weak-model flag; the gap
// between a tool's wall-clock and the weak model running inside it is a coach signal
// worth surfacing, so the UI infers it from the model id.
export function isWeakModel(model: string | undefined): boolean {
  return model != null && /haiku/i.test(model);
}
