import { Handle, Position, type NodeProps } from '@xyflow/react';
import { roleFor } from '../theme.ts';
import { SIDE_HANDLE, type TraceRFNode } from '../layout/types.ts';
import { renderAnchor, renderBanner } from './levels.tsx';
import { renderStep } from './step.tsx';

const TRANSPARENT_HANDLE: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  width: 1,
  height: 1,
};

// One custom React-Flow node, dispatched by structural role: levels render as
// banners, the user prompt as the accent anchor, everything else as a step card.
// Top/bottom handles (no id) carry the vertical spine; the id'd side handles let
// cross-lane edges exit/enter a card's center-height side instead of its bottom.
export function TraceNodeView({ data, selected }: NodeProps<TraceRFNode>) {
  const role = roleFor(data.card.type);
  return (
    <>
      <Handle type="target" position={Position.Top} style={TRANSPARENT_HANDLE} />
      <Handle
        id={SIDE_HANDLE.leftTarget}
        type="target"
        position={Position.Left}
        style={TRANSPARENT_HANDLE}
      />
      <Handle
        id={SIDE_HANDLE.rightTarget}
        type="target"
        position={Position.Right}
        style={TRANSPARENT_HANDLE}
      />
      {role === 'banner' && renderBanner(data.card)}
      {role === 'anchor' && renderAnchor(data.card)}
      {role === 'step' && renderStep(data, selected)}
      <Handle type="source" position={Position.Bottom} style={TRANSPARENT_HANDLE} />
      <Handle
        id={SIDE_HANDLE.leftSource}
        type="source"
        position={Position.Left}
        style={TRANSPARENT_HANDLE}
      />
      <Handle
        id={SIDE_HANDLE.rightSource}
        type="source"
        position={Position.Right}
        style={TRANSPARENT_HANDLE}
      />
    </>
  );
}
