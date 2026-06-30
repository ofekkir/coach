import type { ResolvedNode } from '@coach/pipeline';

import { type NodeCard } from '../format/format.ts';
import { JsonView } from '../JsonView/JsonView.tsx';
import type { HiddenSubCall } from '../layout/types.ts';
import { fonts, monoLabel, tokens } from '../theme.ts';
import { Glyph } from '../TraceNode/Glyph.tsx';

import { contextBlock } from './context.tsx';
import { errorCallout } from './error.tsx';
import { longTextBlock, longTextOf } from './longtext.tsx';

const DURATION_FONT = 18;
const METRIC_FONT = 15;
const MS_PER_SECOND = 1000;
const SECONDS_DECIMALS = 2;

// The static action labels come from the semantics overlay's entries, not the node.
function whatOf(resolved: ResolvedNode | undefined): readonly string[] {
  return (resolved?.semantics?.entries ?? []).map((entry) => entry.static);
}

export function isActionType(type: string): boolean {
  return type === 'action' || type === 'tool';
}

// The second metric cell — the model for inferences, the tool name for actions,
// nothing for levels/prompts (whose tag suffix isn't a tool).
function secondMetric(card: NodeCard): { label: string; value: string } | null {
  if (card.model != null) return { label: 'MODEL', value: card.model };
  const toolName = card.tag.split(' · ')[1];
  if (isActionType(card.type) && toolName != null) return { label: 'TOOL', value: toolName };
  return null;
}

function metricCard(label: string, value: string, accent: boolean): React.ReactNode {
  return (
    <div
      style={{
        background: tokens.surface,
        border: `1px solid ${tokens.insetBorder}`,
        borderRadius: 9,
        padding: '10px 12px',
      }}
    >
      <div
        style={{ fontFamily: fonts.mono, fontSize: 9, letterSpacing: '0.1em', color: tokens.faint }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: fonts.mono,
          fontSize: label === 'DURATION' ? DURATION_FONT : METRIC_FONT,
          fontWeight: 600,
          color: accent ? tokens.accent : tokens.ink,
          marginTop: 3,
        }}
      >
        {value}
      </div>
    </div>
  );
}

function metricsGrid(card: NodeCard, duration: string | null, isLongest: boolean): React.ReactNode {
  const second = secondMetric(card);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
      {duration != null && metricCard('DURATION', duration, isLongest)}
      {second != null && metricCard(second.label, second.value, false)}
    </div>
  );
}

function whatHappened(items: readonly string[]): React.ReactNode {
  if (items.length === 0) return null;
  return (
    <>
      <div style={{ ...monoLabel, marginBottom: 11 }}>WHAT HAPPENED</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 22 }}>
        {items.map((item) => (
          <div key={item} style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: '50%',
                background: tokens.accent,
                flexShrink: 0,
                transform: 'translateY(-2px)',
              }}
            />
            <span
              style={{
                fontFamily: fonts.sans,
                fontSize: 13.5,
                color: tokens.inkValue,
                lineHeight: 1.45,
              }}
            >
              {item}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function hiddenSubCallCallout(sub: HiddenSubCall): React.ReactNode {
  const seconds = (sub.durationMs / MS_PER_SECOND).toFixed(SECONDS_DECIMALS);
  return (
    <div
      style={{
        background: tokens.accentCallout,
        border: `1px solid ${tokens.accentCalloutBorder}`,
        borderRadius: 10,
        padding: '13px 14px',
        marginBottom: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <Glyph kind="diamond-hollow" accent />
        <span
          style={{
            fontFamily: fonts.mono,
            fontSize: 9.5,
            letterSpacing: '0.1em',
            color: tokens.accentInkSoft,
          }}
        >
          HIDDEN SUB-CALL
        </span>
      </div>
      <div
        style={{ fontFamily: fonts.sans, fontSize: 13, lineHeight: 1.5, color: tokens.calloutInk }}
      >
        A second model — <span style={{ fontFamily: fonts.mono, fontSize: 11.5 }}>{sub.model}</span>{' '}
        — ran inside this tool for <span style={{ fontWeight: 600 }}>{seconds}s</span>, doing the
        bulk of its work.
      </div>
    </div>
  );
}

export interface PanelContent {
  card: NodeCard;
  resolved: ResolvedNode | undefined;
  // The flattened node + semantics + deltas, fed raw to the JSON viewer.
  raw: Record<string, unknown> | undefined;
  isLongest: boolean;
  hiddenSubCall: HiddenSubCall | undefined;
  duration: string | null;
  showRaw: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export function panelBody(content: PanelContent): React.ReactNode {
  const { card, resolved, raw, isLongest, hiddenSubCall, duration, showRaw } = content;
  const longText = longTextOf(card, resolved);
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
      {metricsGrid(card, duration, isLongest)}
      {card.error != null && errorCallout(card.error)}
      {whatHappened(whatOf(resolved))}
      {contextBlock(resolved)}
      {hiddenSubCall != null && hiddenSubCallCallout(hiddenSubCall)}
      {longText != null && longTextBlock(longText, content.expanded, content.onToggleExpanded)}
      {showRaw && (
        <div data-raw-node style={{ marginTop: 20 }}>
          <JsonView value={raw} />
        </div>
      )}
    </div>
  );
}
