export interface GraphViewEdge {
  fromId: string;
  toId: string;
  label?: string;
}

export interface GraphViewNode {
  id: string;
  labelLines: string[];
  children: GraphViewNode[];
  innerEdges: GraphViewEdge[];
}

export interface GraphViewThread {
  id: string;
  title: string;
  members: GraphViewNode[];
  edges: GraphViewEdge[];
}

export interface CausalGraphView {
  root: GraphViewNode;
  threads: GraphViewThread[];
  rootToThreadIds: string[];
}

export interface SessionCausalGraphView {
  root: GraphViewNode;
  interactions: Array<{ title: string; view: CausalGraphView }>;
}

export interface AgentCausalGraphView {
  root: GraphViewNode;
  sessions: Array<{ title: string; view: SessionCausalGraphView }>;
}

export type VizData =
  | { kind: 'agent'; data: AgentCausalGraphView }
  | { kind: 'session'; data: SessionCausalGraphView }
  | { kind: 'interaction'; data: CausalGraphView };

declare global {
  interface Window {
    __TRACE_DATA__: VizData;
    __TRACE_TITLE__: string;
  }
}
