// Worktree-stripping path normalization. A node's file path is normalized to ONE
// repo-relative form regardless of which worktree it was accessed under, so the
// same file under two worktrees yields the SAME `nodes.repo_path`. Pure string
// work (no node:path) so the schema + materializeSql stay node:*-free. Rules:
//   1. Worktree segment: a path containing `.claude/worktrees/<id>/<rest>` (or a
//      bare git `worktrees/<id>/<rest>`) collapses to `<rest>` — two worktrees of
//      one repo therefore yield the SAME repo_path.
//   2. cwd-relative: otherwise, if the path sits under the session's cwd, strip the
//      cwd prefix. The cwd is itself worktree-normalized first, so a cwd that is a
//      worktree still strips to the repo root.
// The result never contains `/.claude/worktrees/` and never has a leading `/`.

const WORKTREES_MARKER = '.claude/worktrees/';
const PATH_INPUT_KEYS = ['file_path', 'notebook_path', 'path'] as const;

function afterSegment(path: string, marker: string): string | null {
  const at = path.indexOf(marker);
  if (at < 0) return null;
  const afterMarker = path.slice(at + marker.length);
  const slash = afterMarker.indexOf('/');
  return slash < 0 ? '' : afterMarker.slice(slash + 1);
}

function stripLeadingSlashes(path: string): string {
  let i = 0;
  while (i < path.length && path[i] === '/') i++;
  return path.slice(i);
}

function stripWorktreeSegment(path: string): string {
  const claudeWorktree = afterSegment(path, WORKTREES_MARKER);
  if (claudeWorktree != null) return claudeWorktree;
  const gitWorktree = afterSegment(path, 'worktrees/');
  if (gitWorktree != null) return gitWorktree;
  return path;
}

function stripCwdPrefix(path: string, cwd: string | undefined): string {
  if (cwd == null) return path;
  const repoRoot = stripWorktreeSegment(cwd);
  const withTrailing = repoRoot.endsWith('/') ? repoRoot : `${repoRoot}/`;
  if (path.startsWith(withTrailing)) return path.slice(withTrailing.length);
  if (path === repoRoot) return '';
  return path;
}

export function normalizeRepoPath(
  filePath: string | undefined,
  cwd: string | undefined,
): string | undefined {
  if (filePath == null || filePath === '') return undefined;
  const deWorktreed = stripWorktreeSegment(filePath);
  const relative = deWorktreed === filePath ? stripCwdPrefix(filePath, cwd) : deWorktreed;
  const cleaned = stripLeadingSlashes(relative);
  return cleaned === '' ? undefined : cleaned;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// Tool inputs are serialized JSON; the file-touching tools (Read/Edit/Write/...)
// carry the absolute path under one of a few well-known keys.
export function filePathFromToolInput(toolInput: string | undefined): string | undefined {
  if (toolInput == null) return undefined;
  const parsed: unknown = safeParseJson(toolInput);
  if (parsed == null || typeof parsed !== 'object') return undefined;
  const record = parsed as Record<string, unknown>;
  const key = PATH_INPUT_KEYS.find((k) => typeof record[k] === 'string');
  return key == null ? undefined : (record[key] as string);
}
