import type { LogEntry } from '../types.ts';
import { lastEndedBefore, narrowestContaining } from './id-utils.ts';
import type { SpanMeta } from './id-utils.ts';

export interface HookEntry {
  readonly index: number;
  readonly hookName: string;
  readonly startNs: bigint;
  readonly endNs: bigint;
  readonly durationMs: number | null;
}

function buildCompletesByName(sorted: readonly LogEntry[]): Map<string, bigint[]> {
  const completesByName = new Map<string, bigint[]>();
  for (const log of sorted) {
    if (log.event_name !== 'hook_execution_complete' || log.hook_name == null) continue;
    const list = completesByName.get(log.hook_name) ?? [];
    list.push(BigInt(log.timestamp_ns));
    completesByName.set(log.hook_name, list);
  }
  return completesByName;
}

export function extractHooks(logs: readonly LogEntry[]): HookEntry[] {
  const sorted = [...logs].sort(
    (a, b) => parseInt(a.event_sequence, 10) - parseInt(b.event_sequence, 10),
  );

  const completesByName = buildCompletesByName(sorted);
  const startCountByName = new Map<string, number>();
  const hooks: HookEntry[] = [];
  let index = 0;

  for (const log of sorted) {
    if (log.event_name !== 'hook_execution_start' || log.hook_name == null) continue;
    const count = startCountByName.get(log.hook_name) ?? 0;
    startCountByName.set(log.hook_name, count + 1);

    const startNs = BigInt(log.timestamp_ns);
    const endNs = completesByName.get(log.hook_name)?.[count] ?? startNs;
    const durationMs = log.total_duration_ms != null ? Number(log.total_duration_ms) || null : null;

    hooks.push({ index: index++, hookName: log.hook_name, startNs, endNs, durationMs });
  }

  return hooks;
}

function parseHookEvent(hookName: string): { event: string; toolName: string | null } {
  const i = hookName.indexOf(':');
  if (i === -1) return { event: hookName, toolName: null };
  return { event: hookName.slice(0, i), toolName: hookName.slice(i + 1) || null };
}

const INTERACTION_LEVEL_HOOKS = new Set([
  'UserPromptSubmit',
  'UserPromptExpansion',
  'Stop',
  'StopFailure',
  'SubagentStop',
  'SubagentStart',
]);

function resolvePreToolParent(
  metas: readonly SpanMeta[],
  toolName: string,
  hook: HookEntry,
): string | null {
  const match = metas
    .filter((m) => m.spanType === 'tool' && m.toolName === toolName && m.startNs >= hook.startNs)
    .sort((a, b) => (a.startNs < b.startNs ? -1 : 1))[0];
  return match?.b64 ?? null;
}

function resolvePostToolParent(
  metas: readonly SpanMeta[],
  toolName: string,
  hook: HookEntry,
): string | null {
  const match = metas
    .filter((m) => m.spanType === 'tool' && m.toolName === toolName && m.endNs <= hook.startNs)
    .sort((a, b) => (a.endNs > b.endNs ? -1 : 1))[0];
  return match?.b64 ?? null;
}

function resolveToolHookParent(
  metas: readonly SpanMeta[],
  event: string,
  toolName: string,
  hook: HookEntry,
): string | null {
  if (event === 'PreToolUse') return resolvePreToolParent(metas, toolName, hook);
  if (event === 'PostToolUse') return resolvePostToolParent(metas, toolName, hook);
  return null;
}

export function resolveHookParentB64(metas: readonly SpanMeta[], hook: HookEntry): string | null {
  const { event, toolName } = parseHookEvent(hook.hookName);

  if (toolName != null) return resolveToolHookParent(metas, event, toolName, hook);
  if (INTERACTION_LEVEL_HOOKS.has(event)) {
    return metas.find((m) => m.spanType === 'interaction')?.b64 ?? null;
  }

  return (
    (lastEndedBefore(metas, hook.startNs) ?? narrowestContaining(metas, hook.startNs))?.b64 ?? null
  );
}
