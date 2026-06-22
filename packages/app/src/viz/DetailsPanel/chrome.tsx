import type { NodeCard } from '../format/format.ts';
import { fonts, glyphFor, tokens } from '../theme.ts';
import { Glyph } from '../TraceNode/Glyph.tsx';

// The selected node's header: glyph + `TYPE · SELECTED` + verb + close.
export function panelHeader(
  card: NodeCard,
  nested: boolean,
  headerAccent: boolean,
  typeWord: string,
  onClose: () => void,
): React.ReactNode {
  return (
    <div
      style={{
        padding: '16px 20px',
        borderBottom: `1px solid ${tokens.divider}`,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Glyph kind={glyphFor(card.type, nested)} accent={headerAccent} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 9.5,
            letterSpacing: '0.13em',
            color: tokens.accentInkSoft,
          }}
        >
          {typeWord} · SELECTED
        </div>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: tokens.inkBlack,
            marginTop: 1,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {card.title ?? typeWord}
        </div>
      </div>
      <button
        onClick={onClose}
        style={{
          background: 'none',
          border: 'none',
          color: tokens.faintLane,
          cursor: 'pointer',
          fontSize: 18,
          lineHeight: 1,
          padding: '0 2px',
        }}
      >
        ×
      </button>
    </div>
  );
}

// The footer: a clearly-interactive toggle (chevron + accent label) revealing the
// raw node + its id. The accent + chevron mark it as a control, not a caption, so
// the JSON tree is discoverable. `nodeId` is absent for entity selections (which
// carry no node-table row).
export function panelFooter(
  nodeId: string | undefined,
  showRaw: boolean,
  onToggle: () => void,
): React.ReactNode {
  return (
    <button
      onClick={onToggle}
      style={{
        border: 'none',
        borderTop: `1px solid ${tokens.divider}`,
        background: showRaw ? tokens.surface : 'none',
        padding: '13px 20px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: 'pointer',
        textAlign: 'left',
      }}
    >
      <span
        style={{ fontFamily: fonts.mono, fontSize: 11, color: tokens.accentInkSoft, flexShrink: 0 }}
      >
        {showRaw ? '▾' : '▸'}
      </span>
      <span style={{ fontFamily: fonts.mono, fontSize: 11, color: tokens.accentInkSoft }}>
        {showRaw ? 'hide raw node' : 'view raw node'}
      </span>
      {nodeId != null && (
        <span
          style={{
            fontFamily: fonts.mono,
            fontSize: 11,
            color: tokens.slash,
            marginLeft: 'auto',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {nodeId}
        </span>
      )}
    </button>
  );
}
