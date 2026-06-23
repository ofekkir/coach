import type { ResolvedNode } from '@coach/pipeline';
import { useEffect, useState } from 'react';

import { formatMetrics, type NodeCard } from '../format/format.ts';
import type { HiddenSubCall } from '../layout/types.ts';
import { fonts, tokens } from '../theme.ts';

import { panelFooter, panelHeader } from './chrome.tsx';
import { isActionType, panelBody } from './sections.tsx';

// The flattened view fed to the raw JSON viewer: the node row with its semantic
// overlay and message deltas merged in (the shape a single DB join would yield).
function rawView(resolved: ResolvedNode | undefined): Record<string, unknown> | undefined {
  if (resolved == null) return undefined;
  return { ...resolved.node, ...(resolved.semantics ?? {}), ...(resolved.deltas ?? {}) };
}

export function DetailsPanel({
  card,
  resolved,
  isLongest,
  hiddenSubCall,
  nested,
  showRawDefault,
  onClose,
}: {
  card: NodeCard;
  resolved: ResolvedNode | undefined;
  isLongest: boolean;
  hiddenSubCall: HiddenSubCall | undefined;
  nested: boolean;
  showRawDefault: boolean;
  onClose: () => void;
}) {
  // Seed from the global default; re-sync when the global toggle flips so an
  // already-open card follows it, while the footer button still overrides locally.
  const [showRaw, setShowRaw] = useState(showRawDefault);
  useEffect(() => {
    setShowRaw(showRawDefault);
  }, [showRawDefault]);
  const [expanded, setExpanded] = useState(false);
  const { duration } = formatMetrics(card.metrics);
  const headerAccent = isLongest || isActionType(card.type);
  const typeWord = card.tag.split(' · ')[0] ?? card.type.toUpperCase();
  const raw = rawView(resolved);

  return (
    <div
      style={{
        width: 344,
        flexShrink: 0,
        background: tokens.surfaceWarm,
        borderLeft: `1px solid ${tokens.line}`,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: fonts.sans,
      }}
    >
      {panelHeader(card, nested, headerAccent, typeWord, onClose)}
      {panelBody({
        card,
        resolved,
        raw,
        isLongest,
        hiddenSubCall,
        duration,
        showRaw,
        expanded,
        onToggleExpanded: () => {
          setExpanded((v) => !v);
        },
      })}
      {panelFooter(resolved?.node.id, showRaw, () => {
        setShowRaw((v) => !v);
      })}
    </div>
  );
}
