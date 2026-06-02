import { useCallback, useMemo, useState } from 'react';
import type { GraphViewNode, VizData } from '@coach/pipeline';
import { allExpandableIds, agentRoot, initialExpanded, toAgent } from '../layout/queries.ts';
import { FlowInner } from '../FlowInner/FlowInner.tsx';
import { DetailsPanel } from '../DetailsPanel/DetailsPanel.tsx';
import { Toolbar } from '../Toolbar/Toolbar.tsx';

function findNode(root: GraphViewNode, id: string): GraphViewNode | null {
  if (root.id === id) return root;
  for (const c of root.children) {
    const r = findNode(c, id);
    if (r != null) return r;
  }
  return null;
}

function resolveSelectedNode(data: VizData, selectedId: string): GraphViewNode | null {
  const agent = toAgent(data);
  const allMembers = agent.sessions
    .flatMap((s) => s.view.interactions)
    .flatMap((i) => i.view.threads)
    .flatMap((t) => t.members);
  for (const m of allMembers) {
    const r = findNode(m, selectedId);
    if (r != null) return r;
  }
  return null;
}

export function App({ data, title }: { data: VizData; title: string }) {
  const allExpandable = useMemo(() => allExpandableIds(data), [data]);
  const rootId = useMemo(() => agentRoot(data), [data]);

  const [expanded, setExpanded] = useState<Set<string>>(() => initialExpanded());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => (selectedId != null ? resolveSelectedNode(data, selectedId) : null),
    [selectedId, data],
  );

  const onExpandAll = useCallback(() => {
    setExpanded(new Set(allExpandable));
  }, [allExpandable]);

  const onCollapseAll = useCallback(() => {
    setExpanded(new Set([rootId]));
  }, [rootId]);

  return (
    <div style={{ width: '100vw', height: '100vh', background: '#f8fafc' }}>
      <FlowInner
        data={data}
        expanded={expanded}
        onExpandedChange={setExpanded}
        selectedId={selectedId}
        onSelectId={setSelectedId}
      />
      <Toolbar title={title} onExpandAll={onExpandAll} onCollapseAll={onCollapseAll} />
      {selectedNode != null && (
        <DetailsPanel
          node={selectedNode}
          onClose={() => {
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}
