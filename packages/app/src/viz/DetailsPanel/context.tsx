import type { ResolvedNode, SemanticContext } from '@coach/pipeline';

import { fonts, monoLabel, tokens } from '../theme.ts';

// Self-contained render block for the structured `what`-context (package/file/url)
// the pipeline promoted out of the flattened `what` phrase. Each present field is a
// labeled row; `url` renders as a clickable link. Absent fields are omitted, and the
// whole block is omitted when the node carries no context. Kept localized (own file +
// one call site in panelBody) so unrelated detail-card work rebases cleanly.

function contextOf(resolved: ResolvedNode | undefined): SemanticContext | undefined {
  return resolved?.semantics?.context;
}

function rowLabel(label: string): React.ReactNode {
  return (
    <span
      style={{
        fontFamily: fonts.mono,
        fontSize: 9,
        letterSpacing: '0.1em',
        color: tokens.faint,
        minWidth: 56,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

function textRow(label: string, value: string): React.ReactNode {
  return (
    <div key={label} style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
      {rowLabel(label)}
      <span style={{ fontFamily: fonts.mono, fontSize: 12, color: tokens.inkValue }}>{value}</span>
    </div>
  );
}

function urlRow(url: string): React.ReactNode {
  return (
    <div key="URL" style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
      {rowLabel('URL')}
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        style={{ fontFamily: fonts.mono, fontSize: 12, color: tokens.accent }}
      >
        {url}
      </a>
    </div>
  );
}

function contextRows(context: SemanticContext): React.ReactNode[] {
  const rows: React.ReactNode[] = [];
  if (context.package != null) rows.push(textRow('PACKAGE', context.package));
  if (context.file != null) rows.push(textRow('FILE', context.file));
  if (context.url != null) rows.push(urlRow(context.url));
  return rows;
}

export function contextBlock(resolved: ResolvedNode | undefined): React.ReactNode {
  const context = contextOf(resolved);
  if (context == null) return null;
  const rows = contextRows(context);
  if (rows.length === 0) return null;
  return (
    <>
      <div style={{ ...monoLabel, marginBottom: 11 }}>CONTEXT</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 22 }}>
        {rows}
      </div>
    </>
  );
}
