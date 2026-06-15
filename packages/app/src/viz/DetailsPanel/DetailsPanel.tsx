import { useState } from 'react';
import type { GraphNode } from '@coach/pipeline';
import { fonts, tokens } from '../theme.ts';
import { formatMetrics, type NodeCard } from '../format/format.ts';
import type { HiddenSubCall } from '../layout/types.ts';
import { isActionType, panelBody } from './sections.tsx';
import { panelFooter, panelHeader } from './chrome.tsx';

export function DetailsPanel({
  card,
  canonical,
  isLongest,
  hiddenSubCall,
  nested,
  onClose,
}: {
  card: NodeCard;
  canonical: GraphNode | undefined;
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
        canonical,
        isLongest,
        hiddenSubCall,
        duration,
        showRaw,
        expanded,
        onToggleExpanded: () => {
          setExpanded((v) => !v);
        },
      })}
      {panelFooter(canonical, showRaw, () => {
        setShowRaw((v) => !v);
      })}
    </div>
  );
}
