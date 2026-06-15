import { tokens } from '../theme.ts';
import type { Ctx } from './types.ts';

const EDGE_W = 1.5;
const ACCENT_EDGE_W = 2;

// The neutral containment rail (agent ▸ session ▸ interaction ▸ prompt). Hairline,
// no arrowhead — it reads as a spine, not a directed dependency.
export function link(src: string, tgt: string, ctx: Ctx): void {
  ctx.edges.push({
    id: `e-${src}-${tgt}`,
    source: src,
    target: tgt,
    type: 'smoothstep',
    style: { stroke: tokens.connector, strokeWidth: EDGE_W },
  });
}

// The causal flow edge — the connective tissue of an expanded interaction
// (inference → tool fan-out, tool → inference fan-in, prompt/continuation). Drawn
// hairline and neutral; the edge feeding the longest step or a critical-path
// branch wears the accent, the one reserved-color rule applied to the rail.
// `gapMs` rides quietly in mono when present.
export function causalLink(src: string, tgt: string, label: string | undefined, ctx: Ctx): void {
  const critical = ctx.criticalIds?.has(tgt) === true || ctx.criticalIds?.has(src) === true;
  const accent = tgt === ctx.longestId || critical;
  const stroke = accent ? tokens.accent : tokens.connector;
  ctx.edges.push({
    id: `causal-${src}-${tgt}`,
    source: src,
    target: tgt,
    type: 'smoothstep',
    zIndex: 1,
    ...(label != null
      ? {
          label,
          labelStyle: {
            fill: tokens.faint,
            fontSize: 10,
            fontFamily: "'IBM Plex Mono', monospace",
          },
          labelBgStyle: { fill: tokens.paper, fillOpacity: 0.95 },
        }
      : {}),
    style: { stroke, strokeWidth: accent ? ACCENT_EDGE_W : EDGE_W },
  });
}
