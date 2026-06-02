import type {
  AgentCausalGraphView,
  GraphViewNode,
  GraphViewThread,
  VizData,
} from '@coach/pipeline';
import { placeAgent, sessionWidth } from './place-graph.ts';
import type { Ctx, TraceRFNode } from './types.ts';
import { NW, HG } from './types.ts';
import type { Edge } from '@xyflow/react';

export function toAgent(data: VizData): AgentCausalGraphView {
  if (data.kind === 'agent') return data.data;

  const FAKE: GraphViewNode = {
    id: '__root__',
    labelLines: ['agent'],
    children: [],
    innerEdges: [],
  };

  if (data.kind === 'session') {
    return { root: FAKE, sessions: [{ title: 'session', view: data.data }] };
  }

  const fakeSession = {
    root: { id: '__session__', labelLines: ['session'], children: [], innerEdges: [] },
    interactions: data.data != null ? [{ title: 'interaction', view: data.data }] : [],
  };
  return { root: FAKE, sessions: [{ title: 'session', view: fakeSession }] };
}

export function buildElements(
  data: VizData,
  expanded: Set<string>,
  selected: string | null,
): { nodes: TraceRFNode[]; edges: Edge[] } {
  const agent = toAgent(data);
  const totalSessionsW = agent.sessions.reduce((sum, s, i) => {
    return sum + sessionWidth(s.view) + (i > 0 ? HG : 0);
  }, 0);
  const ctx: Ctx = {
    cx: Math.max(NW, totalSessionsW) / 2 + 50,
    expanded,
    selected,
    nodes: [],
    edges: [],
  };
  placeAgent(agent, ctx);
  return { nodes: ctx.nodes, edges: ctx.edges };
}

export function initialExpanded(): Set<string> {
  return new Set<string>();
}

function expandableInteractionIds(iv: {
  root: GraphViewNode;
  threads: readonly GraphViewThread[];
}): string[] {
  const memberIds = iv.threads
    .flatMap((thread) => thread.members)
    .filter((m) => m.children.length > 0)
    .map((m) => m.id);
  return [iv.root.id, ...memberIds];
}

export function allExpandableIds(data: VizData): Set<string> {
  const agent = toAgent(data);
  const sessionIds = agent.sessions.map((s) => s.view.root.id);
  const interactionExpandables = agent.sessions.flatMap((s) =>
    s.view.interactions.flatMap((i) => expandableInteractionIds(i.view)),
  );
  return new Set([agent.root.id, ...sessionIds, ...interactionExpandables]);
}

export function agentRoot(data: VizData): string {
  return toAgent(data).root.id;
}
