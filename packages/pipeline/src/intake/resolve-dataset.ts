// Repo-name → log-directory resolution. Claude Code stores each working
// directory's session logs under `~/.claude/projects/<encoded-path>/`, where the
// absolute path is encoded by replacing `/` and `.` with `-`. A repo's main
// checkout and every git worktree are SEPARATE encoded directories that share a
// common prefix — the worktree ones tack on `…-claude-worktrees-<id>…`. This
// module maps a repo name (or absolute path) to that whole family of directories
// so `load_dataset` can fold a repo's main checkout and all its worktrees into a
// single dataset by default. This is the only place that knows the on-disk
// projects layout; `intake.ts` just consumes absolute directories.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Everything from the worktree segment onward is dropped to recover the shared
// repo-root key. The separator before `claude-worktrees` is `--` (newer encoding,
// `/.claude` → `--claude`) or `-.` (older encoding that kept the dot).
const WORKTREE_MARKER = /-[-.]claude-worktrees-.*$/;

/** Root holding Claude Code's per-directory session logs. Overridable for tests. */
function projectsRoot(): string {
  return process.env.CLAUDE_PROJECTS_DIR ?? join(homedir(), '.claude', 'projects');
}

function repoRootKey(projectDir: string): string {
  return projectDir.replace(WORKTREE_MARKER, '');
}

function encodeAbsolutePath(path: string): string {
  return `-${path.replace(/^\//, '').replace(/[/.]/g, '-')}`;
}

// A query matches a repo-root key when it is the key's exact encoded form (when an
// absolute path is given) or its trailing path segment (when a bare name is given,
// e.g. `coach` matches `-Users-dev-projects-coach`).
function matchesQuery(repoKey: string, query: string): boolean {
  if (query.startsWith('/')) return repoKey === encodeAbsolutePath(query);
  return repoKey === query || repoKey.endsWith(`-${query}`);
}

function listProjectDirs(root: string): string[] {
  return readdirSync(root).filter((entry) => statSync(join(root, entry)).isDirectory());
}

function groupByRepoRoot(projectDirs: readonly string[]): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const dir of projectDirs) {
    const key = repoRootKey(dir);
    byKey.set(key, [...(byKey.get(key) ?? []), dir]);
  }
  return byKey;
}

export interface ResolvedRepo {
  /** The shared encoded repo-root key the query matched. */
  readonly repoKey: string;
  /** Absolute log directories: the main checkout plus, by default, every worktree. */
  readonly dirs: readonly string[];
}

export interface ResolveOptions {
  /** Fold in git-worktree logs alongside the main checkout. Default true. */
  readonly includeWorktrees?: boolean;
}

// A worktree directory carries the marker; the main checkout's directory equals
// its own repo-root key. Excluding worktrees keeps only the latter.
function selectDirs(
  group: readonly string[],
  repoKey: string,
  includeWorktrees: boolean,
): string[] {
  if (includeWorktrees) return [...group];
  return group.filter((dir) => dir === repoKey);
}

function fail(message: string): never {
  throw new Error(message);
}

/** Resolves a repo name (or absolute path) to its Claude Code log directories —
 *  main checkout plus every git worktree by default. Throws a clear message when
 *  nothing matches or the name is ambiguous across multiple parent paths. */
export function resolveRepoDirs(query: string, options: ResolveOptions = {}): ResolvedRepo {
  const includeWorktrees = options.includeWorktrees ?? true;
  const root = projectsRoot();
  if (!existsSync(root)) fail(`Claude Code projects directory not found: ${root}`);

  const byKey = groupByRepoRoot(listProjectDirs(root));
  const matchedKeys = [...byKey.keys()].filter((key) => matchesQuery(key, query));
  const [repoKey, ...rest] = matchedKeys;
  if (repoKey == null) fail(noMatchMessage(query, root));
  if (rest.length > 0) fail(ambiguousMessage(query, matchedKeys));

  const dirs = selectDirs(byKey.get(repoKey) ?? [], repoKey, includeWorktrees)
    .sort()
    .map((dir) => join(root, dir));
  return { repoKey, dirs };
}

function noMatchMessage(query: string, root: string): string {
  return `no Claude Code logs found for repo '${query}' under ${root} — pass an absolute repo path, or use the 'path' argument to load a directory directly`;
}

function ambiguousMessage(query: string, keys: readonly string[]): string {
  return `repo name '${query}' is ambiguous across: ${keys.join(', ')} — pass an absolute repo path to disambiguate`;
}
