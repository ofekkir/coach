import { useCallback, useMemo, useState } from 'react';
import type { ExecutionGraph } from '@coach/pipeline';
import { allExpandableIds, agentRoot, buildElements, initialExpanded } from '../layout/queries.ts';
import type { Elements } from '../FlowInner/FlowInner.tsx';
import { FlowInner } from '../FlowInner/FlowInner.tsx';
import { DetailsPanel } from '../DetailsPanel/DetailsPanel.tsx';
import { Toolbar } from '../Toolbar/Toolbar.tsx';
import type { TraceRFNodeData } from '../layout/types.ts';

function selectedData(elements: Elements, selectedId: string | null): TraceRFNodeData | null {
  if (selectedId == null) return null;
  const node = elements.nodes.find((n) => n.id === selectedId);
  return node != null ? node.data : null;
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

  const selected = selectedData(elements, selectedId);

  const onExpandAll = useCallback(() => {
    setExpanded(new Set(allExpandable));
  }, [allExpandable]);

  const onCollapseAll = useCallback(() => {
    setExpanded(new Set([rootId]));
  }, [rootId]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f8fafc' }}>
      <FlowInner
        build={build}
        expanded={expanded}
        onExpandedChange={setExpanded}
        selectedId={selectedId}
        onSelectId={setSelectedId}
      />
      <Toolbar title={title} onExpandAll={onExpandAll} onCollapseAll={onCollapseAll} />
      {selected != null && (
        <DetailsPanel
          card={selected.card}
          canonical={selected.canonical}
          onClose={() => {
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}
