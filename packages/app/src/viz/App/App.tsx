import { useCallback, useMemo, useState } from 'react';
import type { GraphData } from '@coach/pipeline';
import { allExpandableIds, agentRoot, buildElements, initialExpanded } from '../layout/queries.ts';
import { allSemanticExpandableIds, buildSemanticElements } from '../layout/place-semantic.ts';
import type { Elements } from '../FlowInner/FlowInner.tsx';
import { FlowInner } from '../FlowInner/FlowInner.tsx';
import { DetailsPanel } from '../DetailsPanel/DetailsPanel.tsx';
import { Toolbar } from '../Toolbar/Toolbar.tsx';
import { TabBar, type Tab } from './TabBar.tsx';

function selectedLabelLines(elements: Elements, selectedId: string | null): string[] | null {
  if (selectedId == null) return null;
  const node = elements.nodes.find((n) => n.id === selectedId);
  return node != null ? node.data.labelLines : null;
}

export function App({ data, title }: { data: GraphData; title: string }) {
  const [tab, setTab] = useState<Tab>('execution');
  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const build = useCallback(
    (exp: Set<string>, sel: string | null): Elements =>
      tab === 'execution'
        ? buildElements(data.execution, exp, sel)
        : buildSemanticElements(data.execution, data.semantic, exp, sel),
    [tab, data],
  );

  const elements = useMemo(() => build(expanded, selectedId), [build, expanded, selectedId]);

  const allExpandable = useMemo(
    () =>
      tab === 'execution'
        ? allExpandableIds(data.execution)
        : allSemanticExpandableIds(data.execution, data.semantic),
    [tab, data],
  );
  const rootId = useMemo(() => agentRoot(data.execution), [data]);

  const labelLines = selectedLabelLines(elements, selectedId);

  const onExpandAll = useCallback(() => {
    setExpanded(new Set(allExpandable));
  }, [allExpandable]);

  const onCollapseAll = useCallback(() => {
    setExpanded(new Set([rootId]));
  }, [rootId]);

  const onTabChange = useCallback((next: Tab) => {
    setTab(next);
    setSelectedId(null);
  }, []);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f8fafc' }}>
      <FlowInner
        build={build}
        expanded={expanded}
        onExpandedChange={setExpanded}
        selectedId={selectedId}
        onSelectId={setSelectedId}
      />
      <TabBar tab={tab} onTabChange={onTabChange} />
      <Toolbar title={title} onExpandAll={onExpandAll} onCollapseAll={onCollapseAll} />
      {labelLines != null && (
        <DetailsPanel
          labelLines={labelLines}
          onClose={() => {
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}
