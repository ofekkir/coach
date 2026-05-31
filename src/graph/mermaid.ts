import type { TraceNode } from '../etl/types.ts';
import type { CausalGraphView, CompositionGraphView, GraphViewNode } from './view-model.ts';
import {
  buildAgentCausalGraphView,
  buildCausalGraphView,
  buildCompositionGraphView,
  buildSessionCausalGraphView,
} from './view-model.ts';

function sanitize(text: string): string {
  return text.replace(/`/g, "'").replace(/"/g, "'");
}

function renderLabel(labelLines: readonly string[]): string {
  return sanitize(labelLines.join('\n'));
}

function renderViewNode(node: GraphViewNode, out: string[], indent: string): void {
  if (node.children.length === 0) {
    out.push(`${indent}${node.id}["\`${renderLabel(node.labelLines)}\`"]`);
    return;
  }

  out.push(`${indent}subgraph sg_${node.id} ["\`${renderLabel(node.labelLines)}\`"]`);
  for (const child of node.children) {
    renderViewNode(child, out, `${indent}  `);
  }
  for (const edge of node.innerEdges) {
    out.push(`${indent}  ${edge.fromId} --> ${edge.toId}`);
  }
  out.push(`${indent}end`);
}

function renderCompositionView(view: CompositionGraphView): string {
  const nodeLines = view.nodes.map((n) => `  ${n.id}["\`${renderLabel(n.labelLines)}\`"]`);
  const edgeLines = view.edges.map((e) => `  ${e.fromId} --> ${e.toId}`);
  return ['graph TD', ...nodeLines, '', ...edgeLines].join('\n');
}

function renderCausalView(view: CausalGraphView): string {
  const out: string[] = ['graph TD'];
  out.push(`  ${view.root.id}["\`${renderLabel(view.root.labelLines)}\`"]`);
  out.push('');

  for (const thread of view.threads) {
    out.push(`  subgraph ${thread.id} ["\`${thread.title}\`"]`);
    for (const member of thread.members) {
      renderViewNode(member, out, '    ');
    }
    for (const edge of thread.edges) {
      const edgeStr = edge.label != null ? `-->|${edge.label}|` : '-->';
      out.push(`    ${edge.fromId} ${edgeStr} ${edge.toId}`);
    }
    out.push('  end');
    out.push(`  ${view.root.id} --> ${thread.id}`);
    out.push('');
  }

  return out.join('\n');
}

export function traceToMermaid(nodes: readonly TraceNode[]): string {
  return renderCompositionView(buildCompositionGraphView(nodes));
}

export function traceToCausalMermaid(nodes: readonly TraceNode[]): string {
  const view = buildCausalGraphView(nodes);
  if (view == null) return 'graph TD\n  %% no interaction node';
  return renderCausalView(view);
}

export function sessionToCausalMermaid(nodes: readonly TraceNode[]): string {
  const view = buildSessionCausalGraphView(nodes);
  if (view == null) return 'graph TD\n  %% no session node';
  return renderCausalView(view);
}

export function agentToCausalMermaid(nodes: readonly TraceNode[]): string {
  const view = buildAgentCausalGraphView(nodes);
  if (view == null) return 'graph TD\n  %% no agent node';
  return renderCausalView(view);
}
