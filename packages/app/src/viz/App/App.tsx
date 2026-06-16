import { useCallback, useMemo, useState } from 'react';
import type { ExecutionGraph, ResolvedNode } from '@coach/pipeline';
import { resolve } from '@coach/pipeline';
import { allExpandableIds, agentRoot, buildElements, initialExpanded } from '../layout/queries.ts';
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

export function App({ data, title }: { data: ExecutionGraph; title: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded());
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
      <TopBar title={title} stats={stats} onExpandAll={onExpandAll} onCollapseAll={onCollapseAll} />
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <FlowInner
            build={build}
            expanded={expanded}
            onExpandedChange={setExpanded}
            selectedId={selectedId}
            onSelectId={setSelectedId}
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
