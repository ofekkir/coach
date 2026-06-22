import type { ResolvedNode } from '@coach/pipeline';
import { useState } from 'react';

import { formatMetrics, type NodeCard } from '../format/format.ts';
import type { HiddenSubCall } from '../layout/types.ts';
import { fonts, tokens } from '../theme.ts';

import { panelFooter, panelHeader } from './chrome.tsx';
import { isActionType, panelBody } from './sections.tsx';

// Why: the flattened view fed to the raw JSON viewer is the node row with its semantic
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
  onClose,
}: {
  card: NodeCard;
  resolved: ResolvedNode | undefined;
  isLongest: boolean;
  hiddenSubCall: HiddenSubCall | undefined;
  nested: boolean;
  onClose: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
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
