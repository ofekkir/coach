import { useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useReactFlow,
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { tokens } from '../theme.ts';
import type { FocusRequest } from '../App/App.tsx';
import type { RFNode } from '../layout/types.ts';
import { TraceNodeView } from '../TraceNode/TraceNode.tsx';
import { BandView } from '../TraceNode/BandNode.tsx';
import { useFlowSync } from './useFlowSync.ts';

const nodeTypes: NodeTypes = { trace: TraceNodeView, band: BandView };

// Delay (ms) before centering on a focused node, letting a freshly-expanded
// ancestor's layout settle so the target node is placed and measured first.
const FOCUS_DELAY_MS = 90;

export interface Elements {
  nodes: RFNode[];
  edges: Edge[];
}

export function FlowInner({
  build,
  expanded,
  onExpandedChange,
  selectedId,
  onSelectId,
  focus,
}: {
  build: (expanded: Set<string>, selected: string | null) => Elements;
  expanded: Set<string>;
  onExpandedChange: (e: Set<string>) => void;
  selectedId: string | null;
  onSelectId: (id: string | null) => void;
  focus: FocusRequest | null;
}) {
  const elements = useMemo(() => build(expanded, selectedId), [build, expanded, selectedId]);

  const { nodes, edges, onNodesChange, onEdgesChange } = useFlowSync(elements);
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (focus == null) return undefined;
    const t = setTimeout(() => {
      void fitView({ nodes: [{ id: focus.id }], padding: 0.45, duration: 450, maxZoom: 1.1 });
    }, FOCUS_DELAY_MS);
    return () => {
      clearTimeout(t);
    };
  }, [focus, fitView]);

  const onNodeClick: NodeMouseHandler<RFNode> = useCallback(
    (_, node) => {
      if (node.type === 'trace') onSelectId(node.id);
    },
    [onSelectId],
  );

  const onNodeDoubleClick: NodeMouseHandler<RFNode> = useCallback(
    (_, node) => {
      if (node.type !== 'trace' || !node.data.hasRFChildren) return;
      const next = new Set(expanded);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      onExpandedChange(next);
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
      style={{ background: tokens.paper }}
    >
      <Background color={tokens.dot} variant={BackgroundVariant.Dots} gap={22} size={1.1} />
      <Controls
        showInteractive={false}
        style={{
          background: tokens.surfaceWarm,
          border: `1px solid ${tokens.line}`,
          borderRadius: 9,
          boxShadow: 'none',
        }}
      />
    </ReactFlow>
  );
}
