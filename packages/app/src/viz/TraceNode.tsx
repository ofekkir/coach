import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { TraceRFNode, TraceRFNodeData } from './layout.ts';

// Keys must match labelLines[0] values from view-model.ts buildLabelLines().
const TYPE_BADGES: Record<string, string> = {
  agent: 'AGENT',
  session: 'SESSION',
  interaction: 'TURN',
  llm_request: 'LLM',
  tool: 'TOOL',
  blocked_on_user: 'WAIT',
  execution: 'EXEC',
  hook: 'HOOK',
};

// Finds the duration line anywhere in the body and separates it out.
// When only body line is the duration, name is empty.
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

// Single line style — truncates with "…" if too wide rather than wrapping.
const LINE: React.CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

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

function NodeBody({
  name,
  details,
  timing,
  color,
}: {
  name: string;
  details: string[];
  timing: string | null;
  color: string;
}) {
  return (
    <div style={{ padding: '6px 10px 8px' }}>
      {name !== '' && (
        <div
          style={{
            ...LINE,
            color: '#1e293b',
            fontSize: 11,
            lineHeight: 1.4,
            marginBottom: details.length > 0 ? 2 : 0,
          }}
        >
          {name}
        </div>
      )}
      {details.map((line, i) => (
        <div
          key={i}
          style={{ ...LINE, color: '#64748b', fontSize: 10, lineHeight: 1.45, marginTop: 1 }}
        >
          {line}
        </div>
      ))}
      {timing !== null && (
        <div
          style={{
            display: 'inline-block',
            marginTop: 5,
            background: `${color}14`,
            border: `1px solid ${color}40`,
            borderRadius: 4,
            padding: '1px 6px',
            color,
            fontSize: 10,
            letterSpacing: '0.02em',
          }}
        >
          {timing}
        </div>
      )}
    </div>
  );
}

export function TraceNodeView({ data, selected }: NodeProps<TraceRFNode>) {
  const { gvNode, color, fill, hasRFChildren, isExpanded }: TraceRFNodeData = data;
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
        {/* header */}
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
          {hasRFChildren && (
            <span style={{ marginLeft: 'auto', color, fontSize: 12, lineHeight: 1, flexShrink: 0 }}>
              {isExpanded ? '▾' : '▸'}
            </span>
          )}
        </div>

        <NodeBody name={name} details={details} timing={timing} color={color} />
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: 'transparent', border: 'none', width: 1, height: 1 }}
      />
    </>
  );
}
