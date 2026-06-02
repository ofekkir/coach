import type { NativeEntry } from './types.ts';

export function parseEntries(jsonl: string): { sessionId: string; entries: NativeEntry[] } {
  let sessionId = '';
  const entries: NativeEntry[] = [];

  for (const line of jsonl.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: NativeEntry;
    try {
      obj = JSON.parse(trimmed) as NativeEntry;
    } catch {
      continue;
    }
    if (typeof obj.sessionId === 'string' && !sessionId) sessionId = obj.sessionId;
    if (typeof obj.uuid === 'string') entries.push(obj);
  }

  return { sessionId, entries };
}

function indexToolResultBlocks(e: NativeEntry, index: Map<string, NativeEntry>): void {
  const content = e.message?.content;
  if (content == null || typeof content === 'string') return;
  for (const block of content) {
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      index.set(block.tool_use_id, e);
    }
  }
}

export function buildToolResultUserIndex(entries: NativeEntry[]): Map<string, NativeEntry> {
  const toolResultUser = new Map<string, NativeEntry>();
  for (const e of entries) {
    if (e.type !== 'user' || !e.timestamp) continue;
    indexToolResultBlocks(e, toolResultUser);
  }
  return toolResultUser;
}

export function buildRequestGroups(entries: NativeEntry[]): Map<string, NativeEntry[]> {
  const requestGroups = new Map<string, NativeEntry[]>();
  for (const e of entries) {
    if (e.type !== 'assistant' || typeof e.requestId !== 'string' || !e.timestamp) continue;
    const group = requestGroups.get(e.requestId) ?? [];
    group.push(e);
    requestGroups.set(e.requestId, group);
  }
  return requestGroups;
}

function entryBlocks(e: NativeEntry): readonly import('./types.ts').ContentBlock[] {
  const c = e.message?.content;
  if (c == null || typeof c === 'string') return [];
  return c;
}

export function collectContentBlocks(group: NativeEntry[]): import('./types.ts').ContentBlock[] {
  return group.flatMap(entryBlocks);
}

export function findEntryWithBlock(group: NativeEntry[], blockId: string): NativeEntry | undefined {
  return group.find((e) => {
    const content = e.message?.content;
    if (content == null || typeof content === 'string') return false;
    return content.some((b) => b.type === 'tool_use' && b.id === blockId);
  });
}

export function findTriggeringUser(
  entry: NativeEntry,
  byUuid: Map<string, NativeEntry>,
): NativeEntry | null {
  let parentUuid = entry.parentUuid ?? null;
  while (parentUuid != null) {
    const parent = byUuid.get(parentUuid);
    if (!parent) break;
    if (parent.type === 'user') return parent;
    parentUuid = parent.parentUuid ?? null;
  }
  return null;
}
