import { useReactFlow } from '@xyflow/react';
import { useEffect } from 'react';

import type { FocusRequest, HighlightFit } from '../App/viewport-targets.ts';

// Delay (ms) before moving the viewport, letting a freshly-expanded ancestor's
// layout settle so the target node(s) are placed and measured first.
const FOCUS_DELAY_MS = 90;
// fitView padding: looser around a single focused node, tighter around a pair so
// both stay large enough to read.
const FOCUS_PADDING = 0.45;
const HIGHLIGHT_PADDING = 0.3;

type FitView = ReturnType<typeof useReactFlow>['fitView'];

function fitToIds(fitView: FitView, ids: string[], padding: number): () => void {
  const t = setTimeout(() => {
    void fitView({ nodes: ids.map((id) => ({ id })), padding, duration: 450, maxZoom: 1.1 });
  }, FOCUS_DELAY_MS);
  return () => {
    clearTimeout(t);
  };
}

// Centers the viewport on a single `focus` node, and (separately) fits it to the
// WHOLE highlighted set so a source/dest pair is visible at once. Each fires on its
// own request nonce; the timeout lets a just-expanded ancestor's layout settle.
export function useViewportFit(
  focus: FocusRequest | null,
  highlightFit: HighlightFit | null,
): void {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (focus == null) return undefined;
    return fitToIds(fitView, [focus.id], FOCUS_PADDING);
  }, [focus, fitView]);

  useEffect(() => {
    if (highlightFit == null) return undefined;
    return fitToIds(fitView, highlightFit.ids, HIGHLIGHT_PADDING);
  }, [highlightFit, fitView]);
}
