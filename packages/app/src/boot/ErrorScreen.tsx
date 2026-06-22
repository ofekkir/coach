// Why: shown when a `?data=<url>` boot fetch or parse fails, so the page
// never crashes to blank.
export function ErrorScreen({ message }: { message: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100vw',
        minHeight: '100vh',
        padding: 24,
        boxSizing: 'border-box',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#f8fafc',
      }}
    >
      <div
        style={{
          maxWidth: 520,
          color: '#dc2626',
          background: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 8,
          padding: '16px 20px',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <strong>Could not load trace</strong>
        <p style={{ margin: '8px 0 0' }}>{message}</p>
      </div>
    </div>
  );
}
