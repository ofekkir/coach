import ReactJsonView from '@uiw/react-json-view';

import { tokens } from '../theme.ts';

// Generic, content-agnostic tree view over any canonical node. It makes NO
// assumptions about field names or value shapes — provider-specific content
// (response blocks, tool_input) renders structurally, like everything else.
// This is the deliberate counterpart to the curated card: the card shows the
// few structural fields we chose; this shows everything the node carries.
export function JsonView({ value }: { value: object | undefined }) {
  if (value == null) {
    return (
      <div style={{ color: tokens.faint, fontSize: 11 }}>No structured data for this node.</div>
    );
  }
  return (
    <ReactJsonView
      value={value}
      collapsed={2}
      displayDataTypes={false}
      displayObjectSize={false}
      enableClipboard
      style={{ fontSize: 11, background: 'transparent' }}
    />
  );
}
