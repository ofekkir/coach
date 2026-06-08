import type { Edge, Node } from '@xyflow/react';
import type { GraphNode } from '@coach/pipeline';
import type { NodeCard } from '../format/format.ts';

export const NW = 210;
export const HG = 56;
export const VG = 44;
export const LG = 60;

/** Top margin of the whole graph on the canvas, in px. */
export const CANVAS_TOP = 50;
/** Divisor for centering a width around a center-x (`cx - width / CENTERING_DIVISOR`). */
export const CENTERING_DIVISOR = 2;

type NodeKind = 'root' | 'session' | 'interaction' | 'member';

export interface TraceRFNodeData extends Record<string, unknown> {
  kind: NodeKind;
  /** Curated, structural-only view-model computed app-side from canonical. */
  card: NodeCard;
  /** The node behind this card — canonical, or its semantic relabel after
   *  enrichment (absent on synthetic nodes). Fed raw to the details JSON viewer. */
  canonical?: GraphNode;
  color: string;
  fill: string;
  hasRFChildren: boolean;
  isExpanded: boolean;
  selected: boolean;
}

export type TraceRFNode = Node<TraceRFNodeData, 'trace'>;

export interface Ctx {
  cx: number;
  expanded: Set<string>;
  selected: string | null;
  nodes: TraceRFNode[];
  edges: Edge[];
}
