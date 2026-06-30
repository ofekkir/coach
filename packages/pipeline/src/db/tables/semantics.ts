import type { TableSpec } from '../spec.ts';

export const SEMANTICS: TableSpec = {
  name: 'semantics',
  doc: "Stage-6/7 semantic labels — ONE ROW PER ENTRY, so a relabeled node maps to N rows ordered by `sequence_in_node` (a tool node is usually one row; an inference that fires three tools is three). Sparse over nodes: only relabeled (tool / llm_request) nodes get rows; the presence of any row IS the 'is this enriched?' flag. `static` is the INPUT-INDEPENDENT label (the act with the specific argument stripped — every 'load a tool schema' reads the same); the argument it acted on lives in `repo_path` / `package` / `url`. Join `id` → nodes.id.",
  columns: [
    { name: 'id', sqlType: 'VARCHAR', doc: 'FK → nodes.id.' },
    // prettier-ignore
    { name: 'sequence_in_node', sqlType: 'INTEGER', doc: 'Dense 0-based order of this entry WITHIN its node — the n-th atomic act the node did. ORDER BY (id, sequence_in_node) reconstructs the ordered entry list. Distinct from nodes.seq (which orders nodes within an interaction).' },
    // prettier-ignore
    { name: 'static', sqlType: 'VARCHAR', doc: "The input-independent action label for this entry, from the closed ontology vocabulary (e.g. 'load tool schema', 'read source code', 'version control'). The specific input (filename, query, tool name) is NEVER folded in — it lives in repo_path / url. See describe_schema → vocabulary." },
    // prettier-ignore
    { name: 'action', sqlType: 'VARCHAR', doc: "Coarse activity bucket this entry rolls up to (an ontology coarseActions id: 'explore'|'author'|'edit'|'run'|'test'|'verify'|'vcs'|'setup'|'mcp'|'meta'|'research'|'delegate'|'plan'|'other'). NON-NULL for tool-node entries (the same value the old nodes.action carried); may be NULL for a bare model-fallback entry. GROUP BY it (filtering to tool nodes via a join) for stable counts." },
    // prettier-ignore
    { name: 'repo_path', sqlType: 'VARCHAR', doc: "The repo-relative file path this entry acted on, worktree+cwd-normalized (grounded in stage 7) — a path under …/.claude/worktrees/<id>/<rest> collapses to <rest>, so the same file under two worktrees yields ONE repo_path; never contains '/.claude/worktrees/' and never has a leading '/'. NULL for non-path entries." },
    // prettier-ignore
    { name: 'package', sqlType: 'VARCHAR', doc: "The workspace package deduced from repo_path via generic monorepo-layout conventions (e.g. 'pipeline' for packages/pipeline/…). NULL when the path is outside a recognized workspace or the entry has no path." },
    // prettier-ignore
    { name: 'url', sqlType: 'VARCHAR', doc: 'The target URL host for a web/fetch entry (e.g. WebFetch). NULL for non-web entries.' },
    {
      name: 'comment',
      sqlType: 'VARCHAR',
      doc: 'Optional agent-authored annotation harvested verbatim (e.g. a Bash `description`). Node-level (carried on the entry it belongs to; tool nodes are single-entry so there is no ambiguity). Display signal only.',
    },
  ],
};
