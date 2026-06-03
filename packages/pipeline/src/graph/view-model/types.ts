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

// Verb on one content block of an inference step.
// verb is an open vocabulary — start: 'reason' | 'act' | 'answer' | 'summarize' | 'generate'.
// blockType is the structural discriminant from the trace (fixed enum).
export interface Move {
  readonly verb: string;
  readonly blockType: 'thinking' | 'text' | 'tool_use';
}

export interface InferenceStepView extends GraphViewNode {
  readonly kind: 'inference';
  readonly moves: readonly Move[];
}

export interface ActionStepView extends GraphViewNode {
  readonly kind: 'action';
  readonly verb: string;
}

export type StepView = InferenceStepView | ActionStepView;

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
