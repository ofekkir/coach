import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ExecutionGraph, ResolvedNode } from '@coach/pipeline';
import { resolve } from '@coach/pipeline';
import {
  allExpandableIds,
  agentRoot,
  buildElements,
  initialExpanded,
  revealPath,
} from '../layout/queries.ts';
import type { Elements } from '../FlowInner/FlowInner.tsx';
import { FlowInner } from '../FlowInner/FlowInner.tsx';
import { DetailsPanel } from '../DetailsPanel/DetailsPanel.tsx';
import { TopBar } from '../TopBar/TopBar.tsx';
import { summarizeRun } from '../TopBar/stats.ts';
import { fonts, tokens } from '../theme.ts';
import type { TraceRFNodeData } from '../layout/types.ts';

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

// A `?focus=<nodeId>` boot param fires the same reveal/select/center path as the
// FocusInput search box, once, after the first render. The ref guards against
// StrictMode's double-invoke and prop identity changes re-triggering it.
function useInitialFocus(initialFocusId: string | undefined, onFocusId: (id: string) => boolean) {
  const focusedOnBoot = useRef(false);
  useEffect(() => {
    if (initialFocusId == null || initialFocusId === '' || focusedOnBoot.current) return;
    focusedOnBoot.current = true;
    onFocusId(initialFocusId);
  }, [initialFocusId, onFocusId]);
}

// The TopBar's expand-all / collapse-all controls over the shared `expanded` set:
// expand-all opens every expandable id; collapse-all leaves only the agent root.
function useExpandControls(
  data: ExecutionGraph,
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
  const allExpandable = useMemo(() => allExpandableIds(data), [data]);
  const rootId = useMemo(() => agentRoot(data), [data]);
  const onExpandAll = useCallback(() => {
    setExpanded(new Set(allExpandable));
  }, [allExpandable, setExpanded]);
  const onCollapseAll = useCallback(() => {
    setExpanded(new Set([rootId]));
  }, [rootId, setExpanded]);
  return { onExpandAll, onCollapseAll };
}

interface AppProps {
  data: ExecutionGraph;
  title: string;
  initialFocusId?: string | undefined;
}

export function App({ data, title, initialFocusId }: AppProps) {
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
  useInitialFocus(initialFocusId, onFocusId);

  const build = useCallback(
    (exp: Set<string>, sel: string | null): Elements => buildElements(data, exp, sel),
    [data],
  );

  const elements = useMemo(() => build(expanded, selectedId), [build, expanded, selectedId]);

  const stats = useMemo(() => summarizeRun(data), [data]);

  const selected = selectedData(elements, selectedId);
  const selectedNode = useMemo(() => selectedResolved(data, selectedId), [data, selectedId]);

  const { onExpandAll, onCollapseAll } = useExpandControls(data, setExpanded);

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
