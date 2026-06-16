import type { Edge, Node } from '@xyflow/react';
import type { ExecutionGraph } from '@coach/pipeline';
import type { NodeCard } from '../format/format.ts';

export const NW = 240;
/** Narrower card width for the dimmed background lane. */
export const BG_NW = 210;
/** Compact card width for branches in a wide (>4) parallel level. */
export const COMPACT_NW = 188;
/** Branch count past which a parallel level renders compact cards. */
export const PARALLEL_COMPACT_THRESHOLD = 4;
export const HG = 56;
export const VG = 44;
export const LG = 60;

/** Horizontal indent (px) of a nested execution child under its parent step. */
export const NESTED_INDENT = 40;
/** Horizontal gap (px) between the main spine column and the background lane. */
export const LANE_GAP = 56;

/** A weak-model sub-call hidden inside a tool — surfaced in the details panel as
 *  the "HIDDEN SUB-CALL" callout when an action's nested inference dominates its
 *  wall-clock. */
export interface HiddenSubCall {
  readonly model: string;
  readonly durationMs: number;
}

/** Top margin of the whole graph on the canvas, in px. */
export const CANVAS_TOP = 50;
/** Divisor for centering a width around a center-x (`cx - width / CENTERING_DIVISOR`). */
export const CENTERING_DIVISOR = 2;

type NodeKind = 'root' | 'session' | 'interaction' | 'member';

export interface TraceRFNodeData extends Record<string, unknown> {
  kind: NodeKind;
  /** Curated, structural-only view-model computed app-side from the resolved node.
   *  Node data is NOT copied onto the React Flow node — the details panel resolves
   *  the selected id against the graph tables on demand. */
  card: NodeCard;
  /** `main` rides the spine; `background` is an off-spine housekeeping thread,
   *  rendered dimmed and set aside. */
  lane: 'main' | 'background';
  /** A nested execution child (e.g. a weak-model inference inside a tool) — drawn
   *  indented under its parent with a sub-rail glyph. */
  nested: boolean;
  /** This is the longest step in its interaction; `shareOfRun` (0..1) is its slice
   *  of the interaction's wall-clock, drawn as the share-of-run bar. */
  isLongest: boolean;
  shareOfRun?: number;
  /** The critical-path branch of a parallel level — its slowest child, which sets
   *  the level's wall-clock. Wears the accent + a `CRITICAL PATH` note. */
  critical?: boolean;
  /** A branch in a wide parallel level (>4): rendered as a compact row (tag +
   *  verb + time only), dropping the sub-verb / model / bar. */
  compact?: boolean;
  /** A weak-model sub-call hidden inside this action, surfaced in the details. */
  hiddenSubCall?: HiddenSubCall;
  hasRFChildren: boolean;
  isExpanded: boolean;
  selected: boolean;
}

export type TraceRFNode = Node<TraceRFNodeData, 'trace'>;

/** A faint band bracketing a parallel level — a backdrop node (pointer-events off,
 *  behind the cards) carrying its size and `PARALLEL LEVEL · ×N` label. */
interface BandData extends Record<string, unknown> {
  width: number;
  height: number;
}

export type BandRFNode = Node<BandData, 'band'>;

/** Any node the renderer places: a trace card or a parallel-level band. */
export type RFNode = TraceRFNode | BandRFNode;

export interface Ctx {
  /** The execution graph — the source of truth for resolving a node id to its
   *  canonical data (+ semantics overlay) when building a card. */
  graph: ExecutionGraph;
  cx: number;
  expanded: Set<string>;
  selected: string | null;
  nodes: RFNode[];
  edges: Edge[];
  /** The longest step in the interaction currently being placed — it (and the
   *  edge into it) wears the accent. `interactionDurMs` is that interaction's
   *  wall-clock, for the share-of-run bar. Reset around each interaction. */
  longestId?: string | undefined;
  interactionDurMs?: number | undefined;
  /** The critical-path branch ids of the interaction's parallel levels — they and
   *  the edges touching them wear the accent. */
  criticalIds?: ReadonlySet<string> | undefined;
}
