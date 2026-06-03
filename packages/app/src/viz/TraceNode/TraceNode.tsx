import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TraceRFNode, TraceRFNodeData } from '../layout/types.ts';
import { NodeBody } from './NodeBody.tsx';
import { StepAnnotation } from './StepAnnotation.tsx';

const TYPE_BADGES: Record<string, string> = {
  agent: 'AGENT',
  session: 'SESSION',
  interaction: 'INTERACTION',
  llm_request: 'LLM',
  tool: 'TOOL',
  blocked_on_user: 'WAIT',
  execution: 'EXEC',
  hook: 'HOOK',
};

function splitLines(lines: readonly string[]): {
  name: string;
  details: string[];
  timing: string | null;
} {
  const body = lines.slice(1);
  const timingIdx = body.findIndex((l) => l.startsWith('duration:'));
  const hasTiming = timingIdx >= 0;
  const nonTimingBody = hasTiming ? body.filter((_, i) => i !== timingIdx) : body;
  const timing = hasTiming ? (body[timingIdx]?.match(/^duration:\s*(.+)$/)?.[1] ?? null) : null;

  return {
    name: nonTimingBody[0] ?? '',
    details: nonTimingBody.slice(1),
    timing,
  };
}

function cardStyle(
  color: string,
  fill: string,
  selected: boolean,
  hasRFChildren: boolean,
): React.CSSProperties {
  return {
    width: 210,
    background: selected ? `${color}18` : fill,
    border: `1.5px solid ${selected ? color : `${color}90`}`,
    borderRadius: 8,
    overflow: 'hidden',
    boxShadow: selected
      ? `0 0 0 2px ${color}30, 0 2px 12px ${color}20`
      : '0 1px 4px rgba(0,0,0,0.08)',
    cursor: hasRFChildren ? 'pointer' : 'default',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    userSelect: 'none',
  };
}

export function TraceNodeView({ data, selected }: NodeProps<TraceRFNode>) {
  const { gvNode, color, fill, hasRFChildren, isExpanded }: TraceRFNodeData = data;
  const { shape, stepKind, verb, moves, segmentIndex }: TraceRFNodeData = data;
  const type = gvNode.labelLines[0] ?? '';
  const badge = TYPE_BADGES[type] ?? type.toUpperCase();
  const { name, details, timing } = splitLines(gvNode.labelLines);

  return (
    <>
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: 'transparent', border: 'none', width: 1, height: 1 }}
      />

      <div style={cardStyle(color, fill, selected, hasRFChildren)}>
        <div
          style={{
            background: `${color}18`,
            borderBottom: `1px solid ${color}30`,
            padding: '4px 10px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span
            style={{
              background: color,
              color: '#fff',
              fontSize: 9,
              fontWeight: 700,
              padding: '1px 6px',
              borderRadius: 3,
              letterSpacing: '0.07em',
              flexShrink: 0,
            }}
          >
            {badge}
          </span>
          {shape != null && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                color: shape === 'query' ? '#44AA99' : '#882255',
                letterSpacing: '0.05em',
                flexShrink: 0,
              }}
            >
              {shape}
            </span>
          )}
          {hasRFChildren && (
            <span style={{ marginLeft: 'auto', color, fontSize: 12, lineHeight: 1, flexShrink: 0 }}>
              {isExpanded ? '▾' : '▸'}
            </span>
          )}
        </div>

        <NodeBody name={name} details={details} timing={timing} color={color} />
        <StepAnnotation
          stepKind={stepKind}
          verb={verb}
          moves={moves}
          segmentIndex={segmentIndex}
          color={color}
        />
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: 'transparent', border: 'none', width: 1, height: 1 }}
      />
    </>
  );
}
