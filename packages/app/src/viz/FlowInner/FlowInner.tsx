import { useCallback, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { TraceRFNode, TraceRFNodeData } from '../layout/types.ts';
import { TraceNodeView } from '../TraceNode/TraceNode.tsx';
import { useFlowSync } from './useFlowSync.ts';

const nodeTypes: NodeTypes = { trace: TraceNodeView };

export interface Elements {
  nodes: TraceRFNode[];
  edges: Edge[];
}

export function FlowInner({
  build,
  expanded,
  onExpandedChange,
  selectedId,
  onSelectId,
}: {
  build: (expanded: Set<string>, selected: string | null) => Elements;
  expanded: Set<string>;
  onExpandedChange: (e: Set<string>) => void;
  selectedId: string | null;
  onSelectId: (id: string | null) => void;
}) {
  const elements = useMemo(() => build(expanded, selectedId), [build, expanded, selectedId]);

  const { nodes, edges, onNodesChange, onEdgesChange } = useFlowSync(elements);

  const onNodeClick: NodeMouseHandler<TraceRFNode> = useCallback(
    (_, node) => {
      onSelectId(node.id);
    },
    [onSelectId],
  );

  const onNodeDoubleClick: NodeMouseHandler<TraceRFNode> = useCallback(
    (_, node) => {
      const d: TraceRFNodeData = node.data;
      if (d.hasRFChildren) {
        const next = new Set(expanded);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        onExpandedChange(next);
      }
    },
    [expanded, onExpandedChange],
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
      onNodeDoubleClick={onNodeDoubleClick}
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
        nodeColor={(n: TraceRFNode) => n.data.color}
        maskColor="rgba(248,250,252,0.75)"
      />
    </ReactFlow>
  );
}
