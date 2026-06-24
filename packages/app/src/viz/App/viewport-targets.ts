import type { ExecutionGraph } from '@coach/pipeline';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Highlight, HighlightRole } from '../highlight/highlight.ts';
import { parseHighlight, revealForHighlight } from '../highlight/highlight.ts';
import { revealPath } from '../layout/queries.ts';

// A focus request — the node to center on plus a monotonic nonce so refocusing the
// same id (already selected/expanded) still re-triggers the viewport animation.
export interface FocusRequest {
  id: string;
  nonce: number;
}

// A request to fit the viewport to a SET of node ids (a highlighted source/dest
// pair) at once, plus a nonce so re-issuing the same ids re-triggers the fit.
export interface HighlightFit {
  ids: string[];
  nonce: number;
}

// A `?focus=<nodeId>` boot param fires the same reveal/select/center path as the
// FocusInput search box, once, after the first render. The ref guards against
// StrictMode's double-invoke and prop identity changes re-triggering it.
function useInitialFocus(initialFocusId: string | undefined, onFocusId: (id: string) => boolean) {
  const focusedOnBoot = useRef(false);
  useEffect(() => {
    if (initialFocusId == null || initialFocusId === '' || focusedOnBoot.current) return;
    focusedOnBoot.current = true;
    onFocusId(initialFocusId);
  }, [initialFocusId, onFocusId]);
}

// A `?source`/`?dest`/`?highlight` boot set reveals every highlighted node's
// ancestors then fits the viewport to all of them at once (vs. `focus`, which
// centers a single node). Runs once after the first render; the ref guards
// StrictMode's double-invoke.
function useInitialHighlight(
  highlight: Highlight | null,
  onHighlight: (highlight: Highlight) => void,
) {
  const highlightedOnBoot = useRef(false);
  useEffect(() => {
    if (highlight == null || highlightedOnBoot.current) return;
    highlightedOnBoot.current = true;
    onHighlight(highlight);
  }, [highlight, onHighlight]);
}

export interface BootTargets {
  focusId?: string | undefined;
  source?: string | undefined;
  dest?: string | undefined;
  highlight?: string | undefined;
}

export interface ViewportTargets {
  focus: FocusRequest | null;
  highlightFit: HighlightFit | null;
  highlightActive: boolean;
  highlightRoles: ReadonlyMap<string, HighlightRole> | null;
  onFocusId: (rawId: string) => boolean;
}

// Owns the viewport-targeting state: the single-node `focus` (TopBar search + the
// `?focus` boot param) and the source/dest pair `highlight` (the `?source`/`?dest`
// boot set). Both reveal needed ancestors via the shared `setExpanded`/`setSelected`
// setters before asking the canvas to move. Kept out of App so its body stays small.
export function useViewportTargets(
  data: ExecutionGraph,
  boot: BootTargets,
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>,
  setSelectedId: (id: string | null) => void,
): ViewportTargets {
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [highlightFit, setHighlightFit] = useState<HighlightFit | null>(null);
  const focusNonce = useRef(0);
  const highlightNonce = useRef(0);

  const highlight = useMemo(
    () => parseHighlight({ source: boot.source, dest: boot.dest, highlight: boot.highlight }),
    [boot.source, boot.dest, boot.highlight],
  );

  const onFocusId = useCallback(
    (rawId: string): boolean => {
      const id = rawId.trim();
      const reveal = id === '' ? null : revealPath(data, id);
      if (reveal == null) return false;
      setExpanded((prev) => new Set([...prev, ...reveal]));
      setSelectedId(id);
      focusNonce.current += 1;
      setFocus({ id, nonce: focusNonce.current });
      return true;
    },
    [data, setExpanded, setSelectedId],
  );
  useInitialFocus(boot.focusId, onFocusId);

  const onHighlight = useCallback(
    (req: Highlight): void => {
      const reveal = revealForHighlight(data, req);
      const fitIds = req.fitIds.filter((id) => revealPath(data, id) != null);
      if (reveal.size > 0) setExpanded((prev) => new Set([...prev, ...reveal]));
      if (fitIds.length === 0) return;
      highlightNonce.current += 1;
      setHighlightFit({ ids: fitIds, nonce: highlightNonce.current });
    },
    [data, setExpanded],
  );
  useInitialHighlight(highlight, onHighlight);

  return {
    focus,
    highlightFit,
    highlightActive: highlight != null,
    highlightRoles: highlight?.roles ?? null,
    onFocusId,
  };
}
