import type { ResolvedNode } from '@coach/pipeline';

import { DetailsPanel } from '../DetailsPanel/DetailsPanel.tsx';
import type { TraceRFNodeData } from '../layout/types.ts';

interface SelectedPanelProps {
  selected: TraceRFNodeData | null;
  selectedId: string | null;
  selectedNode: ResolvedNode | undefined;
  showRaw: boolean;
  onToggleShowRaw: () => void;
  onClose: () => void;
}

// The right-hand detail pane: renders nothing unless a node is selected. Split out
// of App so App stays within the per-function line budget and to keep the
// selection-empty guard in one place.
export function SelectedPanel({
  selected,
  selectedId,
  selectedNode,
  showRaw,
  onToggleShowRaw,
  onClose,
}: SelectedPanelProps) {
  if (selected == null) return null;
  return (
    <DetailsPanel
      key={selectedId}
      card={selected.card}
      resolved={selectedNode}
      isLongest={selected.isLongest}
      hiddenSubCall={selected.hiddenSubCall}
      nested={selected.nested}
      showRaw={showRaw}
      onToggleShowRaw={onToggleShowRaw}
      onClose={onClose}
    />
  );
}
