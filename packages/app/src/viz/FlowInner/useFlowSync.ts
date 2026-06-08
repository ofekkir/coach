import { useEffect, useRef } from 'react';
import {
  useEdgesState,
  useNodesState,
  useReactFlow,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import type { Edge } from '@xyflow/react';
import type { TraceRFNode } from '../layout/types.ts';

// Delay (ms) before the one-time auto fit-to-view, letting the DOM settle first.
const FIT_DELAY_MS = 40;

interface Elements {
  nodes: TraceRFNode[];
  edges: Edge[];
}

interface FlowSync {
  nodes: TraceRFNode[];
  edges: Edge[];
  onNodesChange: OnNodesChange<TraceRFNode>;
  onEdgesChange: OnEdgesChange;
}

export function useFlowSync(elements: Elements): FlowSync {
  const { fitView } = useReactFlow();
  const didFit = useRef(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<TraceRFNode>(elements.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(elements.edges);

  useEffect(() => {
    setNodes(elements.nodes);
    setEdges(elements.edges);
    if (!didFit.current) {
      didFit.current = true;
      const t = setTimeout(() => {
        void fitView({ padding: 0.12 });
      }, FIT_DELAY_MS);
      return () => {
        clearTimeout(t);
      };
    }
    return undefined;
  }, [elements, setNodes, setEdges, fitView]);

  return { nodes, edges, onNodesChange, onEdgesChange };
}
