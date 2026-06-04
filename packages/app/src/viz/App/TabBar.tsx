export type Tab = 'execution' | 'semantic';

const TABS: { id: Tab; label: string }[] = [
  { id: 'execution', label: 'Execution' },
  { id: 'semantic', label: 'Semantic' },
];

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? '#1e293b' : '#ffffff',
    color: active ? '#ffffff' : '#475569',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 14px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
  };
}

export function TabBar({ tab, onTabChange }: { tab: Tab; onTabChange: (t: Tab) => void }) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 16,
        left: 16,
        zIndex: 10,
        display: 'flex',
        gap: 6,
      }}
    >
      {TABS.map((t) => (
        <button
          key={t.id}
          style={tabStyle(t.id === tab)}
          onClick={() => {
            onTabChange(t.id);
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
