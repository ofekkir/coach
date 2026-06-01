import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  allExpandableIds,
  agentRoot,
  buildElements,
  colorOf,
  initialExpanded,
  type TraceRFNodeData,
} from './layout.ts';
import { TraceNodeView } from './TraceNode.tsx';
import type { GraphViewNode, VizData } from './types.ts';

const DATA: VizData = window.__TRACE_DATA__;
const TITLE: string = window.__TRACE_TITLE__ ?? 'Trace Viewer';
const ALL_EXPANDABLE = allExpandableIds(DATA);
const ROOT_ID = agentRoot(DATA);

const nodeTypes: NodeTypes = { trace: TraceNodeView };

// ── details panel ─────────────────────────────────────────────────────────────

function DetailsPanel({ node, onClose }: { node: GraphViewNode; onClose: () => void }) {
  const type = node.labelLines[0] ?? '';
  const color = colorOf(type);

  return (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        background: '#ffffff',
        borderLeft: '1px solid #e2e8f0',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.06)',
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e2e8f0',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{
            background: color,
            color: '#fff',
            fontSize: 9,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 3,
            letterSpacing: '0.07em',
          }}
        >
          {type.toUpperCase()}
        </span>
        <button
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            background: 'none',
            border: 'none',
            color: '#94a3b8',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
            padding: '0 2px',
          }}
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
        {node.labelLines.slice(1).map((line, i) => {
          const colon = line.indexOf(':');
          const key = colon > 0 ? line.slice(0, colon) : null;
          const val = colon > 0 ? line.slice(colon + 1).trim() : line;
          const isLong = val.length > 80;
          return (
            <div key={i} style={{ marginBottom: 12 }}>
              {key !== null && (
                <div
                  style={{
                    color: '#94a3b8',
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    marginBottom: 3,
                  }}
                >
                  {key}
                </div>
              )}
              <div
                style={{
                  color: '#374151',
                  fontSize: 11,
                  fontFamily: isLong ? 'monospace' : 'system-ui, sans-serif',
                  lineHeight: 1.55,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  background: isLong ? '#f8fafc' : 'transparent',
                  borderRadius: isLong ? 6 : 0,
                  padding: isLong ? '6px 8px' : 0,
                  border: isLong ? '1px solid #e2e8f0' : 'none',
                  maxHeight: 200,
                  overflowY: 'auto',
                }}
              >
                {val}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── toolbar ───────────────────────────────────────────────────────────────────

function Toolbar({
  onExpandAll,
  onCollapseAll,
}: {
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  const btnStyle: React.CSSProperties = {
    background: '#ffffff',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    color: '#475569',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 500,
    padding: '5px 10px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  };
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: 16,
        zIndex: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div
        style={{
          color: '#94a3b8',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {TITLE}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button style={btnStyle} onClick={onExpandAll}>
          Expand all
        </button>
        <button style={btnStyle} onClick={onCollapseAll}>
          Collapse all
        </button>
      </div>
    </div>
  );
}

// ── inner flow ────────────────────────────────────────────────────────────────

function FlowInner({
  expanded,
  onExpandedChange,
  selectedId,
  onSelectId,
}: {
  expanded: Set<string>;
  onExpandedChange: (e: Set<string>) => void;
  selectedId: string | null;
  onSelectId: (id: string | null) => void;
}) {
  const { fitView } = useReactFlow();

  const elements = useMemo(() => buildElements(DATA, expanded, selectedId), [expanded, selectedId]);

  const [nodes, setNodes, onNodesChange] = useNodesState(elements.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(elements.edges);

  useEffect(() => {
    setNodes(elements.nodes);
    setEdges(elements.edges);
    const t = setTimeout(() => {
      void fitView({ padding: 0.12, duration: 300 });
    }, 40);
    return () => {
      clearTimeout(t);
    };
  }, [elements, setNodes, setEdges, fitView]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => {
      const d = node.data as unknown as TraceRFNodeData;
      if (d.hasRFChildren) {
        const next = new Set(expanded);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        onExpandedChange(next);
        onSelectId(null);
      } else {
        onSelectId(node.id === selectedId ? null : node.id);
      }
    },
    [expanded, selectedId, onExpandedChange, onSelectId],
  );

  const onPaneClick = useCallback(() => {
    onSelectId(null);
  }, [onSelectId]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onPaneClick={onPaneClick}
      nodeTypes={nodeTypes}
      fitView
      proOptions={{ hideAttribution: true }}
      minZoom={0.05}
      maxZoom={4}
    >
      <Background color="#e2e8f0" variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      />
      <MiniMap
        style={{
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
        nodeColor={(n) => (n.data as unknown as TraceRFNodeData).color ?? '#94a3b8'}
        maskColor="rgba(248,250,252,0.75)"
      />
    </ReactFlow>
  );
}

// ── root ──────────────────────────────────────────────────────────────────────

export function App() {
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded(DATA));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedNode = useMemo((): GraphViewNode | null => {
    if (selectedId == null) return null;
    function find(n: GraphViewNode): GraphViewNode | null {
      if (n.id === selectedId) return n;
      for (const c of n.children) {
        const r = find(c);
        if (r != null) return r;
      }
      return null;
    }
    if (DATA.kind !== 'agent') return null;
    for (const { view: sv } of DATA.data.sessions) {
      for (const { view: iv } of sv.interactions) {
        for (const thread of iv.threads) {
          for (const m of thread.members) {
            const r = find(m);
            if (r != null) return r;
          }
        }
      }
    }
    return null;
  }, [selectedId]);

  const onExpandAll = useCallback(() => {
    setExpanded(new Set(ALL_EXPANDABLE));
  }, []);
  const onCollapseAll = useCallback(() => {
    setExpanded(new Set([ROOT_ID]));
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f8fafc' }}>
      <FlowInner
        expanded={expanded}
        onExpandedChange={setExpanded}
        selectedId={selectedId}
        onSelectId={setSelectedId}
      />
      <Toolbar onExpandAll={onExpandAll} onCollapseAll={onCollapseAll} />
      {selectedNode != null && (
        <DetailsPanel
          node={selectedNode}
          onClose={() => {
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}
