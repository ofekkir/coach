import type { Edge, Node } from '@xyflow/react';
import type { CanonicalNode, InteractionShape, Move } from '@coach/pipeline';

export const NW = 210;
export const HG = 56;
export const VG = 44;
export const LG = 60;

/** Prefix for layout container ids (semantic-node and segment cards), kept
 *  distinct from the plain canonical ids that `GraphEdge` endpoints reference.
 *  Layout maps plain ids → these. */
const SUBGRAPH_PREFIX = 'sg_';

export function subgraphId(plainId: string): string {
  return `${SUBGRAPH_PREFIX}${plainId}`;
}

type NodeKind = 'root' | 'session' | 'interaction' | 'member' | 'segment' | 'step';

export interface TraceRFNodeData extends Record<string, unknown> {
  kind: NodeKind;
  /** Derived display text (line 0 == structural type), computed app-side from canonical. */
  labelLines: string[];
  /** The structural canonical node behind this card (absent on synthetic/segment nodes). */
  canonical?: CanonicalNode;
  color: string;
  fill: string;
  hasRFChildren: boolean;
  isExpanded: boolean;
  selected: boolean;
  // Interaction-specific
  shape?: InteractionShape;
  // Step-specific (a step card == an execution node annotated with its semantics)
  stepKind?: 'inference' | 'action';
  verb?: string;
  moves?: readonly Move[];
  segmentIndex?: number;
}

export type TraceRFNode = Node<TraceRFNodeData, 'trace'>;

export interface Ctx {
  cx: number;
  expanded: Set<string>;
  selected: string | null;
  nodes: TraceRFNode[];
  edges: Edge[];
}
