import type { TraceNode } from '../etl/types.ts';
import type { CausalGraphView, CompositionGraphView, GraphViewNode } from './view-model.ts';
import { buildCausalGraphView, truncate } from './view-model.ts';

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function labelDiv(lines: readonly string[]): string {
  return `<div class="label">${esc(lines.join('\n'))}</div>`;
}

function renderMember(node: GraphViewNode): string {
  if (node.children.length === 0) {
    return `<div class="node leaf">${labelDiv(node.labelLines)}</div>`;
  }
  const childrenHtml = node.children.map(renderMember).join('');
  return `<details class="node branch" open>
    <summary>${labelDiv(node.labelLines)}</summary>
    <div class="node-children">${childrenHtml}</div>
  </details>`;
}

function renderThreadColumns(view: CausalGraphView): string {
  return view.threads
    .map((thread) => {
      let membersHtml = '';
      for (let i = 0; i < thread.members.length; i++) {
        const member = thread.members[i];
        if (member == null) continue;
        membersHtml += renderMember(member);
        if (i < thread.members.length - 1) {
          const label = thread.edges[i]?.label;
          membersHtml += `<div class="edge-label">${label != null ? esc(label) : '↓'}</div>`;
        }
      }
      return `<details class="thread" open>
  <summary>${esc(thread.title)}</summary>
  <div class="members">${membersHtml}</div>
</details>`;
    })
    .join('');
}

// Returns all nodes in the subtree rooted at rootId (inclusive).
function getSubtree(nodes: readonly TraceNode[], rootId: string): TraceNode[] {
  const result: TraceNode[] = [];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id == null) continue;
    const node = nodes.find((n) => n.id === id);
    if (node == null) continue;
    result.push(node);
    for (const child of nodes.filter((n) => n.parent === id)) {
      queue.push(child.id);
    }
  }
  return result;
}

function sortedChildren(nodes: readonly TraceNode[], parentId: string): TraceNode[] {
  return nodes
    .filter((n) => n.parent === parentId)
    .sort((a, b) => {
      const aStart = a.start_time_ns != null ? BigInt(a.start_time_ns) : 0n;
      const bStart = b.start_time_ns != null ? BigInt(b.start_time_ns) : 0n;
      return aStart < bStart ? -1 : aStart > bStart ? 1 : 0;
    });
}

function renderInteractionSection(
  interaction: TraceNode,
  allNodes: readonly TraceNode[],
  index: number,
): string {
  const view = buildCausalGraphView(getSubtree(allNodes, interaction.id));
  if (view == null) return '';

  const title =
    interaction.prompt != null
      ? truncate(interaction.prompt.replace(/\s+/g, ' '), 60)
      : `interaction ${String(index + 1)}`;

  return `<details class="interaction" open>
  <summary>${esc(title)}</summary>
  <div class="interaction-body">
    <div class="threads">${renderThreadColumns(view)}</div>
  </div>
</details>`;
}

const STYLES = `
*, *::before, *::after { box-sizing: border-box; }
body { font: 13px/1.5 system-ui, sans-serif; background: #f2f2f2; margin: 0; padding: 1.5rem; color: #222; }
h1 { font-size: 0.8rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #888; margin: 0 0 1rem; }
.label { white-space: pre-wrap; word-break: break-word; }
.root-node { display: inline-block; background: #dbeafe; border: 1.5px solid #93c5fd; border-radius: 6px; padding: 0.5rem 0.9rem; margin-bottom: 0.5rem; }
.down-arrow { color: #94a3b8; padding-left: 0.25rem; line-height: 1; margin-bottom: 0.5rem; }
details.session { background: #fff; border: 1.5px solid #c7d2fe; border-radius: 8px; overflow: hidden; margin-bottom: 0.75rem; }
details.session > summary { list-style: none; padding: 0.45rem 0.75rem; background: #eef2ff; border-bottom: 1px solid #c7d2fe; font-weight: 600; font-size: 0.8rem; cursor: pointer; user-select: none; }
details.session > summary::marker, details.session > summary::-webkit-details-marker { display: none; }
details.session > summary::before { content: '▶ '; font-size: 0.65rem; color: #6366f1; }
details.session[open] > summary::before { content: '▼ '; }
.session-body { padding: 0.75rem; display: flex; flex-direction: column; gap: 0.5rem; }
details.interaction { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
details.interaction > summary { list-style: none; padding: 0.45rem 0.75rem; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-size: 0.8rem; cursor: pointer; user-select: none; }
details.interaction > summary::marker, details.interaction > summary::-webkit-details-marker { display: none; }
details.interaction > summary::before { content: '▶ '; font-size: 0.65rem; color: #64748b; }
details.interaction[open] > summary::before { content: '▼ '; }
.interaction-body { padding: 0.75rem; }
.threads { display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
details.thread { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; min-width: 200px; flex: 1 1 200px; overflow: hidden; }
details.thread > summary { list-style: none; padding: 0.45rem 0.75rem; background: #f8fafc; border-bottom: 1px solid #e2e8f0; font-weight: 600; font-size: 0.78rem; cursor: pointer; user-select: none; }
details.thread > summary::marker, details.thread > summary::-webkit-details-marker { display: none; }
details.thread > summary::before { content: '▶ '; font-size: 0.65rem; color: #64748b; }
details.thread[open] > summary::before { content: '▼ '; }
.members { padding: 0.6rem; display: flex; flex-direction: column; gap: 0; }
.node.leaf { padding: 0.45rem 0.7rem; background: #fafafa; border: 1px solid #e2e8f0; border-radius: 5px; }
details.node.branch { border: 1px solid #e2e8f0; border-radius: 5px; overflow: hidden; }
details.node.branch > summary { list-style: none; padding: 0.45rem 0.7rem; background: #f0f9ff; border-bottom: 1px solid #e2e8f0; cursor: pointer; user-select: none; }
details.node.branch > summary::marker, details.node.branch > summary::-webkit-details-marker { display: none; }
details.node.branch > summary::before { content: '▶ '; font-size: 0.65rem; color: #64748b; }
details.node.branch[open] > summary::before { content: '▼ '; }
.node-children { padding: 0.5rem; display: flex; flex-direction: column; gap: 0.4rem; background: #f8fafc; }
.edge-label { text-align: center; color: #94a3b8; font-size: 0.75rem; padding: 0.1rem 0; }
.tree { display: flex; flex-direction: column; gap: 0.5rem; }
`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>${STYLES}</style>
</head>
<body>${body}
</body>
</html>`;
}

export function buildCausalHtml(view: CausalGraphView, title: string): string {
  const rootHtml = `<div class="root-node">${labelDiv(view.root.labelLines)}</div>`;
  return page(
    title,
    `
<h1>${esc(title)}</h1>
${rootHtml}
<div class="down-arrow">↓</div>
<div class="threads">${renderThreadColumns(view)}</div>`,
  );
}

export function buildSessionCausalHtml(nodes: readonly TraceNode[], title: string): string {
  const session = nodes.find((n) => n.type === 'session');
  if (session == null) return page(title, '<p>No session node</p>');

  const sessionLabel = ['session', session.session_id].filter(Boolean).join('\n');
  const interactions = sortedChildren(nodes, session.id).filter((n) => n.type === 'interaction');

  const sectionsHtml = interactions
    .map((interaction, i) => renderInteractionSection(interaction, nodes, i))
    .join('');

  return page(
    title,
    `
<h1>${esc(title)}</h1>
<div class="root-node"><div class="label">${esc(sessionLabel)}</div></div>
<div class="down-arrow">↓</div>
<div style="display:flex;flex-direction:column;gap:0.5rem">${sectionsHtml}</div>`,
  );
}

export function buildAgentCausalHtml(nodes: readonly TraceNode[], title: string): string {
  const agent = nodes.find((n) => n.type === 'agent');
  if (agent == null) return page(title, '<p>No agent node</p>');

  const agentLabel = ['agent', agent.user_id].filter(Boolean).join('\n');
  const sessions = sortedChildren(nodes, agent.id).filter((n) => n.type === 'session');

  const sessionsHtml = sessions
    .map((session, si) => {
      const sessionTitle =
        session.session_id != null ? truncate(session.session_id, 40) : `session ${String(si + 1)}`;
      const interactions = sortedChildren(nodes, session.id).filter(
        (n) => n.type === 'interaction',
      );
      const interactionsHtml = interactions
        .map((interaction, i) => renderInteractionSection(interaction, nodes, i))
        .join('');
      return `<details class="session" open>
  <summary>${esc(sessionTitle)}</summary>
  <div class="session-body">${interactionsHtml}</div>
</details>`;
    })
    .join('');

  return page(
    title,
    `
<h1>${esc(title)}</h1>
<div class="root-node"><div class="label">${esc(agentLabel)}</div></div>
<div class="down-arrow">↓</div>
<div>${sessionsHtml}</div>`,
  );
}

export function buildCompositionHtml(view: CompositionGraphView, title: string): string {
  const childrenOf = new Map<string, string[]>();
  const hasParent = new Set<string>();
  for (const edge of view.edges) {
    const list = childrenOf.get(edge.fromId) ?? [];
    list.push(edge.toId);
    childrenOf.set(edge.fromId, list);
    hasParent.add(edge.toId);
  }

  const nodeMap = new Map(view.nodes.map((n) => [n.id, n]));

  function renderTree(id: string): string {
    const node = nodeMap.get(id);
    if (node == null) return '';
    const children = childrenOf.get(id) ?? [];
    if (children.length === 0) {
      return `<div class="node leaf">${labelDiv(node.labelLines)}</div>`;
    }
    return `<details class="node branch" open>
  <summary>${labelDiv(node.labelLines)}</summary>
  <div class="node-children">${children.map(renderTree).join('')}</div>
</details>`;
  }

  const roots = view.nodes.filter((n) => !hasParent.has(n.id));
  const treeHtml = roots.map((n) => renderTree(n.id)).join('');

  return page(
    title,
    `
<h1>${esc(title)}</h1>
<div class="tree">${treeHtml}</div>`,
  );
}
