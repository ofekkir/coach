import type { SemanticsConfig } from '@coach/semantics';

import { normalizeRepoPath } from '../../db/repo-path.ts';
import type { SemanticEntry, SemanticFields, Session } from '../../types.ts';
import type { ExecutionGraph } from '../types.ts';

// ════════════════════════════════════════════════════════════════════════════
// Resolve / grounding stage (stage 7) — the seam where node-local stage-6 labels
// meet SESSION dimension data (the cwd). Stage 6 is deliberately node-local and
// harness-agnostic, so it leaves each path-bearing entry's argument as a raw,
// un-normalized `rawPath`. This stage grounds it: `rawPath` → `repoPath` (worktree +
// cwd normalized, the same basis the old `nodes.repo_path` carried) and the deduced
// `package`, then drops `rawPath`. Everything cwd-dependent lives here, so stage 6
// stays pure and `materialize.ts` stays a mechanical graph→SQL writer.
//
// Pure (no node:*): `normalizeRepoPath` is pure string work; the only inputs are the
// graph's own entries and its sessions' cwd.
// ════════════════════════════════════════════════════════════════════════════

const STRUCTURE_PACKAGE_QUALIFIER = 'package';

function sessionsOf(graph: ExecutionGraph): readonly Session[] {
  if (graph.kind === 'agent') return graph.data.sessions.map((s) => s.session);
  if (graph.kind === 'session') return [graph.data.session];
  return [];
}

/** The workspace package deduced from a repo-relative path via the ontology's
 *  generic monorepo-layout conventions (e.g. `packages/pipeline/…` → `pipeline`).
 *  Undefined when no structure rule matches. */
function structurePackage(config: SemanticsConfig, path: string): string | undefined {
  const rule = config.ontology.conventions?.structure?.rules.find(
    (r) => r.qualifier === STRUCTURE_PACKAGE_QUALIFIER,
  );
  if (rule == null) return undefined;
  const captured = new RegExp(rule.match, 'i').exec(path)?.[1];
  return captured != null && captured !== '' ? captured : undefined;
}

/** Grounds one entry: a `rawPath` becomes the normalized `repoPath` + deduced
 *  `package`; `rawPath` is dropped. Non-path entries pass through unchanged (minus
 *  the absent `rawPath`). */
function groundEntry(
  config: SemanticsConfig,
  entry: SemanticEntry,
  cwd: string | undefined,
): SemanticEntry {
  const repoPath = entry.rawPath != null ? normalizeRepoPath(entry.rawPath, cwd) : undefined;
  const pkg = repoPath != null ? structurePackage(config, repoPath) : undefined;
  return {
    static: entry.static,
    ...(entry.action != null ? { action: entry.action } : {}),
    ...(repoPath != null ? { repoPath } : {}),
    ...(pkg != null ? { package: pkg } : {}),
    ...(entry.url != null ? { url: entry.url } : {}),
  };
}

function groundFields(
  config: SemanticsConfig,
  fields: SemanticFields,
  cwd: string | undefined,
): SemanticFields {
  return {
    ...fields,
    entries: fields.entries.map((entry) => groundEntry(config, entry, cwd)),
  };
}

/**
 * Stage 7: grounds every semantics entry's `rawPath` to a `repoPath` + `package`
 * using the owning session's cwd, returning the graph with a resolved `semantics`
 * table (and everything else untouched). The cwd-dependent counterpart to the
 * node-local stage 6 — after this stage no entry carries a `rawPath`.
 */
export function resolveGraph(graph: ExecutionGraph, config: SemanticsConfig): ExecutionGraph {
  const cwdBySession = new Map(sessionsOf(graph).map((s) => [s.id, s.cwd]));
  const semantics: Record<string, SemanticFields> = {};
  for (const [id, fields] of Object.entries(graph.semantics)) {
    const cwd = cwdBySession.get(graph.nodes[id]?.sessionId ?? '');
    semantics[id] = groundFields(config, fields, cwd);
  }
  return { ...graph, semantics };
}
