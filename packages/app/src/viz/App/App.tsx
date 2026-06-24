import type { ExecutionGraph, ResolvedNode } from '@coach/pipeline';
import { resolve } from '@coach/pipeline';
import { useCallback, useMemo, useState } from 'react';

import { FlowInner } from '../FlowInner/FlowInner.tsx';
import type { Elements } from '../FlowInner/FlowInner.tsx';
import { agentRoot, buildElements, initialExpanded } from '../layout/queries.ts';
import type { TraceRFNodeData } from '../layout/types.ts';
import { fonts, tokens } from '../theme.ts';
import { summarizeRun } from '../TopBar/stats.ts';
import { TopBar } from '../TopBar/TopBar.tsx';

import { SelectedPanel } from './SelectedPanel.tsx';
import { useViewportTargets } from './viewport-targets.ts';

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

// The TopBar's collapse-all control over the shared `expanded` set:
// collapse-all leaves only the agent root.
function useExpandControls(
  data: ExecutionGraph,
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
  const rootId = useMemo(() => agentRoot(data), [data]);
  const onCollapseAll = useCallback(() => {
    setExpanded(new Set([rootId]));
  }, [rootId, setExpanded]);
  return { onCollapseAll };
}

interface AppProps {
  data: ExecutionGraph;
  title: string;
  initialFocusId?: string | undefined;
  initialSource?: string | undefined;
  initialDest?: string | undefined;
  initialHighlight?: string | undefined;
}

export function App({
  data,
  title,
  initialFocusId,
  initialSource,
  initialDest,
  initialHighlight,
}: AppProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showRawDefault, setShowRawDefault] = useState(false);

  const { focus, highlightFit, highlightActive, highlightRoles, onFocusId } = useViewportTargets(
    data,
    {
      focusId: initialFocusId,
      source: initialSource,
      dest: initialDest,
      highlight: initialHighlight,
    },
    setExpanded,
    setSelectedId,
  );

  const build = useCallback(
    (exp: Set<string>, sel: string | null): Elements =>
      buildElements(data, exp, sel, highlightRoles),
    [data, highlightRoles],
  );

  const elements = useMemo(() => build(expanded, selectedId), [build, expanded, selectedId]);

  const stats = useMemo(() => summarizeRun(data), [data]);

  const selected = selectedData(elements, selectedId);
  const selectedNode = useMemo(() => selectedResolved(data, selectedId), [data, selectedId]);

  const { onCollapseAll } = useExpandControls(data, setExpanded);

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
        onCollapseAll={onCollapseAll}
        showRaw={showRawDefault}
        onToggleShowRaw={() => {
          setShowRawDefault((v) => !v);
        }}
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
            highlightFit={highlightFit}
            highlightActive={highlightActive}
          />
        </div>
        <SelectedPanel
          selected={selected}
          selectedId={selectedId}
          selectedNode={selectedNode}
          showRawDefault={showRawDefault}
          onClose={() => {
            setSelectedId(null);
          }}
        />
      </div>
    </div>
  );
}
