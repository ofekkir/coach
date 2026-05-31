import { readFileSync, writeFileSync } from 'node:fs';
import type { TraceNode } from '../src/etl/types.ts';

const nodesPath = process.argv[2];
if (!nodesPath) {
  console.error('Usage: pnpm viz <out/fixture/nodes-suffix.json>');
  process.exit(1);
}

const nodes = JSON.parse(readFileSync(nodesPath, 'utf8')) as TraceNode[];
const outPath = nodesPath.replace(/\.json$/, '.html');

// ── HTML generation ───────────────────────────────────────────────────────────

const TYPE_COLORS: Partial<Record<TraceNode['type'], string>> = {
  agent: '#7c3aed',
  session: '#2563eb',
  interaction: '#0891b2',
  llm_request: '#d97706',
  tool: '#059669',
  'tool.blocked_on_user': '#ca8a04',
  'tool.execution': '#10b981',
  hook: '#db2777',
};

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}

function nodeLabel(node: TraceNode): string {
  const lines: string[] = [node.type];
  switch (node.type) {
    case 'agent':
      if (node.user_id != null) lines.push(truncate(node.user_id, 16));
      break;
    case 'session':
      if (node.session_id != null) lines.push(truncate(node.session_id, 36));
      break;
    case 'interaction':
      if (node.prompt != null) lines.push(truncate(node.prompt, 40));
      break;
    case 'llm_request':
      if (node.model != null) lines.push(node.model);
      if (node.tokens_in != null)
        lines.push(`in:${String(node.tokens_in)} out:${String(node.tokens_out ?? 0)}`);
      break;
    case 'tool':
      if (node.name != null) lines.push(node.name);
      break;
    case 'hook':
      if (node.name != null) lines.push(node.name);
      break;
  }
  if (node.duration_ms != null && node.type !== 'agent' && node.type !== 'session') {
    lines.push(`${String(Math.round(node.duration_ms))}ms`);
  }
  return lines.join('\n');
}

interface NodeData {
  id: string;
  parentId: string | null;
  label: string;
  type: string;
  color: string;
  extra: Record<string, unknown>;
}

function buildNodeData(nodes: TraceNode[]): NodeData[] {
  return nodes.map((node) => {
    const extra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k !== 'id' && k !== 'parent' && v != null) extra[k] = v;
    }
    return {
      id: node.id,
      parentId: node.parent ?? null,
      label: nodeLabel(node),
      type: node.type,
      color: TYPE_COLORS[node.type] ?? '#6b7280',
      extra,
    };
  });
}

function buildHtml(nodes: TraceNode[], title: string): string {
  const nodeData = buildNodeData(nodes);
  const legendRows = Object.entries(TYPE_COLORS)
    .map(
      ([type, color]) =>
        `<div class="lr"><div class="ld" style="background:${color}"></div>${type}</div>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>viz — ${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:system-ui,sans-serif;background:#1e293b}
    #cy{position:fixed;inset:0}
    #bar{position:fixed;top:12px;left:12px;z-index:10;display:flex;flex-direction:column;gap:6px}
    button{padding:5px 11px;border-radius:6px;border:1px solid #475569;background:#334155;color:#e2e8f0;cursor:pointer;font-size:12px}
    button:hover{background:#475569}
    #legend{position:fixed;bottom:12px;left:12px;z-index:10;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;font-size:11px;display:flex;flex-direction:column;gap:4px;color:#e2e8f0}
    .lr{display:flex;align-items:center;gap:6px}
    .ld{width:9px;height:9px;border-radius:50%;flex-shrink:0}
    #tip{position:fixed;bottom:12px;right:12px;z-index:10;background:#1e293b;border:1px solid #334155;border-radius:8px;padding:12px 14px;font-size:11px;font-family:monospace;max-width:380px;max-height:55vh;overflow-y:auto;display:none;white-space:pre-wrap;color:#e2e8f0}
  </style>
</head>
<body>
  <div id="cy"></div>
  <div id="bar">
    <button onclick="collapseAll()">Collapse all</button>
    <button onclick="expandAll()">Expand all</button>
    <button onclick="cy.fit(undefined,60)">Fit</button>
  </div>
  <div id="legend">
    ${legendRows}
    <div style="margin-top:6px;color:#94a3b8;line-height:1.5">Click node with children to expand/collapse<br>Click leaf to inspect · background click to close</div>
  </div>
  <div id="tip"></div>

  <script src="https://unpkg.com/cytoscape@3.29.2/dist/cytoscape.min.js"></script>
  <script>
    // ── data ──────────────────────────────────────────────────────────────────
    const RAW = ${JSON.stringify(nodeData)};

    const childrenOf = {};   // parentId → [childId, ...]
    RAW.forEach(n => {
      if (n.parentId) {
        if (!childrenOf[n.parentId]) childrenOf[n.parentId] = [];
        childrenOf[n.parentId].push(n.id);
      }
    });

    function hasChildren(id) { return !!(childrenOf[id]?.length); }

    function allDescendants(id) {
      const out = [];
      const q = [...(childrenOf[id] || [])];
      while (q.length) {
        const cur = q.shift();
        out.push(cur);
        (childrenOf[cur] || []).forEach(c => q.push(c));
      }
      return out;
    }

    // ── cytoscape init ────────────────────────────────────────────────────────
    const cyNodes = RAW.map(n => ({
      data: { id: n.id, label: labelFor(n), color: n.color, nodeData: n }
    }));
    const cyEdges = RAW.filter(n => n.parentId).map(n => ({
      data: { id: 'e_' + n.parentId + '_' + n.id, source: n.parentId, target: n.id }
    }));

    function labelFor(n) {
      return hasChildren(n.id) ? '▶ ' + n.label : n.label;
    }

    const cy = cytoscape({
      container: document.getElementById('cy'),
      elements: [...cyNodes, ...cyEdges],
      style: [
        {
          selector: 'node',
          style: {
            label: 'data(label)',
            'text-valign': 'center',
            'text-halign': 'center',
            'text-wrap': 'wrap',
            'text-max-width': '160px',
            'font-size': '11px',
            'background-color': 'data(color)',
            color: '#fff',
            'text-outline-color': 'data(color)',
            'text-outline-width': 2,
            width: 'label',
            height: 'label',
            padding: '12px',
            shape: 'round-rectangle',
          },
        },
        {
          selector: 'edge',
          style: {
            width: 2,
            'line-color': '#475569',
            'target-arrow-color': '#475569',
            'target-arrow-shape': 'triangle',
            'curve-style': 'taxi',
            'taxi-direction': 'downward',
          },
        },
      ],
      layout: { name: 'preset' },
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });

    // ── collapse / expand ─────────────────────────────────────────────────────
    const expanded = new Set();   // nodes whose children are currently visible

    function runLayout() {
      const visibleRoots = cy.nodes(':visible').filter(n => !RAW.find(r => r.id === n.id())?.parentId
        || !cy.getElementById(RAW.find(r => r.id === n.id()).parentId).visible());
      cy.layout({
        name: 'breadthfirst',
        directed: true,
        animate: false,
        padding: 60,
        spacingFactor: 1.4,
        roots: visibleRoots.map(n => '#' + n.id()),
        fit: true,
      }).run();
      cy.fit(undefined, 60);
    }

    function showChildren(id) {
      (childrenOf[id] || []).forEach(cid => {
        cy.getElementById(cid).style('display', 'element');
        cy.getElementById('e_' + id + '_' + cid).style('display', 'element');
      });
      expanded.add(id);
      cy.getElementById(id).data('label', '▼ ' + RAW.find(n => n.id === id).label);
    }

    function hideDescendants(id) {
      allDescendants(id).forEach(did => {
        cy.getElementById(did).style('display', 'none');
        (childrenOf[did] || []).forEach(cid => {
          cy.getElementById('e_' + did + '_' + cid).style('display', 'none');
        });
        cy.getElementById('e_' + RAW.find(n => n.id === did)?.parentId + '_' + did).style('display', 'none');
        expanded.delete(did);
      });
      (childrenOf[id] || []).forEach(cid => {
        cy.getElementById('e_' + id + '_' + cid).style('display', 'none');
      });
      expanded.delete(id);
      cy.getElementById(id).data('label', '▶ ' + RAW.find(n => n.id === id).label);
    }

    function toggleNode(id) {
      if (!hasChildren(id)) return;
      if (expanded.has(id)) {
        hideDescendants(id);
      } else {
        showChildren(id);
      }
      runLayout();
    }

    function collapseAll() {
      // hide everything except roots
      RAW.forEach(n => {
        if (n.parentId) {
          cy.getElementById(n.id).style('display', 'none');
          cy.getElementById('e_' + n.parentId + '_' + n.id).style('display', 'none');
        }
      });
      expanded.clear();
      RAW.filter(n => !n.parentId && hasChildren(n.id)).forEach(n => {
        cy.getElementById(n.id).data('label', '▶ ' + n.label);
      });
      runLayout();
    }

    function expandAll() {
      RAW.forEach(n => {
        cy.getElementById(n.id).style('display', 'element');
        if (n.parentId) cy.getElementById('e_' + n.parentId + '_' + n.id).style('display', 'element');
      });
      RAW.filter(n => hasChildren(n.id)).forEach(n => {
        expanded.add(n.id);
        cy.getElementById(n.id).data('label', '▼ ' + n.label);
      });
      runLayout();
    }

    // ── inspector ─────────────────────────────────────────────────────────────
    const tip = document.getElementById('tip');

    cy.on('tap', 'node', evt => {
      const id = evt.target.id();
      if (hasChildren(id)) {
        toggleNode(id);
      } else {
        const nd = RAW.find(n => n.id === id);
        tip.style.display = 'block';
        tip.textContent = JSON.stringify({ id: nd.id, type: nd.type, ...nd.extra }, null, 2);
      }
    });

    cy.on('tap', evt => { if (evt.target === cy) tip.style.display = 'none'; });

    // ── init ──────────────────────────────────────────────────────────────────
    collapseAll();
  </script>
</body>
</html>`;
}

writeFileSync(outPath, buildHtml(nodes, nodesPath));
console.log(`wrote ${outPath}`);
