import type { ExecutionGraph, ResolvedNode } from '@coach/pipeline';
import { resolve } from '@coach/pipeline';
import { useCallback, useMemo, useRef, useState } from 'react';

import { DetailsPanel } from '../DetailsPanel/DetailsPanel.tsx';
import { FlowInner } from '../FlowInner/FlowInner.tsx';
import type { Elements } from '../FlowInner/FlowInner.tsx';
import {
  allExpandableIds,
  agentRoot,
  buildElements,
  initialExpanded,
  revealPath,
} from '../layout/queries.ts';
import type { TraceRFNodeData } from '../layout/types.ts';
import { fonts, tokens } from '../theme.ts';
import { summarizeRun } from '../TopBar/stats.ts';
import { TopBar } from '../TopBar/TopBar.tsx';

function selectedData(elements: Elements, selectedId: string | null): TraceRFNodeData | null {
  if (selectedId == null) return null;
  const node = elements.nodes.find((n) => n.id === selectedId);
  return node?.type === 'trace' ? node.data : null;
}

// Resolves the selected id against the node table — entity selections (agent /
// session containers) carry no node-table row, so they resolve to undefined.
function selectedResolved(
  graph: ExecutionGraph,
  selectedId: string | null,
): ResolvedNode | undefined {
  if (selectedId == null || !(selectedId in graph.nodes)) return undefined;
  return resolve(graph, selectedId);
}

// A focus request — the node to center on plus a monotonic nonce so refocusing the
// same id (already selected/expanded) still re-triggers the viewport animation.
export interface FocusRequest {
  id: string;
  nonce: number;
}

export function App({ data, title }: { data: ExecutionGraph; title: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const focusNonce = useRef(0);

  // Reveals (expands ancestors of), selects, and centers the viewport on a node by
  // id. Returns false when no such node exists so the caller can flag the input.
  const onFocusId = useCallback(
    (rawId: string): boolean => {
      const id = rawId.trim();
      const reveal = id === '' ? null : revealPath(data, id);
      if (reveal == null) return false;
      setExpanded((prev) => new Set([...prev, ...reveal]));
      setSelectedId(id);
      focusNonce.current += 1;
      setFocus({ id, nonce: focusNonce.current });
      return true;
    },
    [data],
  );

  const build = useCallback(
    (exp: Set<string>, sel: string | null): Elements => buildElements(data, exp, sel),
    [data],
  );

  const elements = useMemo(() => build(expanded, selectedId), [build, expanded, selectedId]);

  const allExpandable = useMemo(() => allExpandableIds(data), [data]);
  const rootId = useMemo(() => agentRoot(data), [data]);
  const stats = useMemo(() => summarizeRun(data), [data]);

  const selected = selectedData(elements, selectedId);
  const selectedNode = useMemo(() => selectedResolved(data, selectedId), [data, selectedId]);

  const onExpandAll = useCallback(() => {
    setExpanded(new Set(allExpandable));
  }, [allExpandable]);

  const onCollapseAll = useCallback(() => {
    setExpanded(new Set([rootId]));
  }, [rootId]);

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: tokens.pageBg,
        fontFamily: fonts.sans,
      }}
    >
      <TopBar
        title={title}
        stats={stats}
        onExpandAll={onExpandAll}
        onCollapseAll={onCollapseAll}
        onFocus={onFocusId}
      />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <FlowInner
            build={build}
            expanded={expanded}
            onExpandedChange={setExpanded}
            selectedId={selectedId}
            onSelectId={setSelectedId}
            focus={focus}
          />
        </div>
        {selected != null && (
          <DetailsPanel
            key={selectedId}
            card={selected.card}
            resolved={selectedNode}
            isLongest={selected.isLongest}
            hiddenSubCall={selected.hiddenSubCall}
            nested={selected.nested}
            onClose={() => {
              setSelectedId(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
