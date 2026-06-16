import { tokens } from '../theme.ts';
import { SIDE_HANDLE, type Ctx } from './types.ts';

const EDGE_W = 1.5;
const ACCENT_EDGE_W = 2;

// Which lane a placed node rides, or undefined for non-trace nodes (bands).
function laneOf(id: string, ctx: Ctx): 'main' | 'background' | undefined {
  const node = ctx.nodes.find((n) => n.id === id);
  return node?.type === 'trace' ? node.data.lane : undefined;
}

function posXOf(id: string, ctx: Ctx): number | undefined {
  return ctx.nodes.find((n) => n.id === id)?.position.x;
}

// A causal edge that crosses between the spine and the background lane exits/enters
// the cards' sides (at center height) instead of bottom→top, so the junction lines
// up with the cards rather than jogging at an unrelated mid-height. Same-lane edges
// keep the default top/bottom handles (the vertical spine). Returns the handle pair,
// or `{}` to leave the edge on its defaults.
function crossLaneHandles(
  src: string,
  tgt: string,
  ctx: Ctx,
): { sourceHandle?: string; targetHandle?: string } {
  const srcLane = laneOf(src, ctx);
  const tgtLane = laneOf(tgt, ctx);
  if (srcLane == null || tgtLane == null || srcLane === tgtLane) return {};
  const srcX = posXOf(src, ctx);
  const tgtX = posXOf(tgt, ctx);
  if (srcX == null || tgtX == null) return {};
  return tgtX >= srcX
    ? { sourceHandle: SIDE_HANDLE.rightSource, targetHandle: SIDE_HANDLE.leftTarget }
    : { sourceHandle: SIDE_HANDLE.leftSource, targetHandle: SIDE_HANDLE.rightTarget };
}

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
    ...crossLaneHandles(src, tgt, ctx),
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
