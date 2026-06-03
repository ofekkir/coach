export interface GraphViewEdge {
  fromId: string;
  toId: string;
  label?: string;
}

export interface GraphViewNode {
  id: string;
  labelLines: readonly string[];
  children: readonly GraphViewNode[];
  innerEdges: readonly GraphViewEdge[];
}

export type StepView = GraphViewNode & { kind: 'inference' | 'action' };

export interface GraphViewThread {
  id: string;
  title: string;
  members: readonly StepView[];
  edges: readonly GraphViewEdge[];
}

export interface CausalGraphView {
  root: GraphViewNode;
  threads: readonly GraphViewThread[];
  rootToThreadIds: readonly string[];
}

export interface SessionCausalGraphView {
  root: GraphViewNode;
  interactions: readonly { readonly title: string; readonly view: CausalGraphView }[];
}

export interface AgentCausalGraphView {
  root: GraphViewNode;
  sessions: readonly { readonly title: string; readonly view: SessionCausalGraphView }[];
}

export type VizData =
  | { kind: 'agent'; data: AgentCausalGraphView }
  | { kind: 'session'; data: SessionCausalGraphView }
  | { kind: 'interaction'; data: CausalGraphView | null };
