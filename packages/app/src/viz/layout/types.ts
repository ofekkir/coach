import type { Edge, Node } from '@xyflow/react';
import type { GraphViewNode } from '@coach/pipeline';

export const NW = 210;
export const HG = 56;
export const VG = 44;
export const LG = 60;

type NodeKind = 'root' | 'session' | 'interaction' | 'member';

export interface TraceRFNodeData extends Record<string, unknown> {
  kind: NodeKind;
  gvNode: GraphViewNode;
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
