import {
  SYNTHETIC_AGENT_ID,
  addSessionNode,
  aggregateAgent,
  aggregateSession,
  groupSessionsByAgent,
} from './etl/aggregate.ts';
import { enrichTrace } from './etl/enrich.ts';
import { nativeSessionToTrace } from './etl/native.ts';
import { transformTrace } from './etl/transform.ts';
import type { LogEntry, TempoTrace, TraceNode } from './etl/types.ts';
import {
  buildAgentCausalGraphView,
  buildCausalGraphView,
  buildSessionCausalGraphView,
} from './graph/view-model.ts';
import type { VizData } from './graph/view-model.ts';

// ── Public types ──────────────────────────────────────────────────────────────

/** A single in-memory file presented by the caller (browser File.text() or Node fs.readFileSync). */
export interface UploadedFile {
  /** Filename only, e.g. "session.jsonl" or "trace-abc123.json". OTEL detection keys on this. */
  name: string;
  /** Full text content of the file. */
  content: string;
  /**
   * Relative path including directory, e.g. "projA/logs.json".
   * Absent for loose files (top-level uploads with no subdirectory).
   * Used to bucket OTEL sets by source directory so projA/logs.json only
   * pairs with projA/trace-*.json.
   */
  path?: string;
}

/** One visualisable result produced from the uploaded files. */
export interface VizResult {
  /** Short human-readable label for this result (used as a tab title). */
  title: string;
  /** The processed view-model data ready for the graph renderer. */
  data: VizData;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sortByTime(nodes: readonly TraceNode[]): TraceNode[] {
  return [...nodes].sort((a, b) => {
    if (!a.start_time_ns && !b.start_time_ns) return 0;
    if (!a.start_time_ns) return -1;
    if (!b.start_time_ns) return 1;
    const diff = BigInt(a.start_time_ns) - BigInt(b.start_time_ns);
    return diff < 0n ? -1 : diff > 0n ? 1 : 0;
  });
}

function buildVizData(nodes: readonly TraceNode[]): VizData {
  const agentView = buildAgentCausalGraphView(nodes);
  if (agentView != null) return { kind: 'agent', data: agentView };
  const sessionView = buildSessionCausalGraphView(nodes);
  if (sessionView != null) return { kind: 'session', data: sessionView };
  return { kind: 'interaction', data: buildCausalGraphView(nodes) };
}

function processNativeFile(file: UploadedFile): TraceNode[] {
  const trace = nativeSessionToTrace(file.content);
  return sortByTime(addSessionNode(transformTrace(trace)));
}

interface OtelBucket { logs: UploadedFile | null; traces: UploadedFile[] }

function buildOtelBuckets(otelFiles: readonly UploadedFile[]): Map<string, OtelBucket> {
  const buckets = new Map<string, OtelBucket>();
  for (const file of otelFiles) {
    const dir = dirOf(file);
    const bucket = buckets.get(dir) ?? { logs: null, traces: [] };
    if (file.name === 'logs.json') {
      bucket.logs = file;
    } else {
      bucket.traces.push(file);
    }
    buckets.set(dir, bucket);
  }
  return buckets;
}

function warnIfMultipleAgents(agentGroups: Map<string, TraceNode[][]>): void {
  if (agentGroups.size <= 1) return;
  const realIds = [...agentGroups.keys()].filter((id) => id !== SYNTHETIC_AGENT_ID);
  if (realIds.length > 1) {
    console.warn(
      `[coach] Multiple distinct user.ids found in upload (${realIds.join(', ')}). ` +
        'Emitting one result per agent. Multi-agent UI is not implemented.',
    );
  }
}

function processOtelSet(logsContent: string, traceFiles: UploadedFile[]): TraceNode[][] {
  const logs = JSON.parse(logsContent) as LogEntry[];
  return traceFiles.map((tf) => {
    const trace = JSON.parse(tf.content) as TempoTrace;
    const enriched = enrichTrace(trace, logs);
    return addSessionNode(transformTrace(enriched));
  });
}

/** Returns the directory portion of a file path (everything before the last '/'), or '' for loose files. */
function dirOf(file: UploadedFile): string {
  const p = file.path ?? file.name;
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(0, idx) : '';
}

function isTraceFile(name: string): boolean {
  return name === 'trace.json' || (name.startsWith('trace-') && name.endsWith('.json'));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Processes a flat list of in-memory files and returns one VizResult per agent.
 *
 * Domain model:
 *   - Each file/OTEL-set = one session.
 *   - All sessions roll up under a single agent (identified by OTEL user.id, or
 *     a shared synthetic id when user.id is absent — e.g. native .jsonl uploads).
 *   - Expected output: exactly one VizResult. If multiple distinct user.ids appear,
 *     one result is emitted per agent and a warning is logged.
 *
 * Input shapes:
 *   (a) *.jsonl files          → one session node-array per file.
 *   (b) OTEL sets bucketed by source directory (path prefix):
 *       logs.json + trace*.json in the same directory → one session per directory bucket.
 *       Bucketing fixes the cross-contamination bug where a single logs.json was
 *       incorrectly paired with traces from sibling directories.
 */
export function buildVizResults(files: readonly UploadedFile[]): VizResult[] {
  const sessionNodeArrays: TraceNode[][] = [];

  // ── Native .jsonl files ──────────────────────────────────────────────────────
  for (const file of files.filter((f) => f.name.endsWith('.jsonl'))) {
    sessionNodeArrays.push(processNativeFile(file));
  }

  // ── OTEL sets bucketed by source directory ───────────────────────────────────
  const otelFiles = files.filter((f) => f.name === 'logs.json' || isTraceFile(f.name));
  const buckets = buildOtelBuckets(otelFiles);

  for (const [, { logs, traces }] of buckets) {
    if (logs == null || traces.length === 0) continue;
    const sorted = [...traces].sort((a, b) => a.name.localeCompare(b.name));
    const perTraceNodes = processOtelSet(logs.content, sorted);
    sessionNodeArrays.push(aggregateSession(perTraceNodes));
  }

  if (sessionNodeArrays.length === 0) return [];

  // ── Group sessions by agent and emit one VizResult per agent ─────────────────
  const agentGroups = groupSessionsByAgent(sessionNodeArrays);
  warnIfMultipleAgents(agentGroups);

  const results: VizResult[] = [];
  for (const [agentId, sessionArrays] of agentGroups) {
    const allSessionNodes = aggregateSession(sessionArrays);
    const agentNodes = aggregateAgent(allSessionNodes);
    const title = agentId === SYNTHETIC_AGENT_ID ? 'agent' : agentId;
    results.push({ title, data: buildVizData(agentNodes) });
  }

  return results;
}
