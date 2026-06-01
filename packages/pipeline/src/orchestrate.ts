import { addSessionNode, aggregateAgent, aggregateSession } from './etl/aggregate.ts';
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
  /** Filename only, e.g. "session.jsonl" or "trace-abc123.json". */
  name: string;
  /** Full text content of the file. */
  content: string;
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

function processOtelSet(logsContent: string, traceFiles: UploadedFile[]): TraceNode[][] {
  const logs = JSON.parse(logsContent) as LogEntry[];
  return traceFiles.map((tf) => {
    const trace = JSON.parse(tf.content) as TempoTrace;
    const enriched = enrichTrace(trace, logs);
    return addSessionNode(transformTrace(enriched));
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Processes a flat list of in-memory files and returns one VizResult per
 * visualisable artifact.
 *
 * Supported input shapes (v1):
 *   (a) One or more `*.jsonl` files  →  one result per file (native Claude Code logs).
 *   (b) `logs.json` + `trace.json`   →  single-trace OTEL result.
 *   (c) `logs.json` + `trace-*.json` →  per-trace results + session + agent views.
 *
 * Multi-session-by-user_id (currently handled by the CLI via directory walking)
 * is not supported via flat browser upload. If needed, add folder upload support
 * via <input webkitdirectory> and pass all files from subdirectories here.
 *
 * This function is the ONLY place where pipeline logic is invoked from the app.
 * Swapping it for an HTTP call (fetch('/api/process', ...)) is the single change
 * needed to move processing to a backend — see data-source.ts in @coach/app.
 */
export function buildVizResults(files: readonly UploadedFile[]): VizResult[] {
  const results: VizResult[] = [];

  // ── Native .jsonl files ──────────────────────────────────────────────────────
  const nativeFiles = files.filter((f) => f.name.endsWith('.jsonl'));
  for (const file of nativeFiles) {
    const nodes = processNativeFile(file);
    const title = file.name.replace(/\.jsonl$/, '');
    results.push({ title, data: buildVizData(nodes) });
  }

  // ── OTEL set (logs.json + trace*.json) ───────────────────────────────────────
  const logsFile = files.find((f) => f.name === 'logs.json');
  const traceFiles = files
    .filter(
      (f) => f.name === 'trace.json' || (f.name.startsWith('trace-') && f.name.endsWith('.json')),
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  if (logsFile != null && traceFiles.length > 0) {
    const allTraceNodes = processOtelSet(logsFile.content, traceFiles);

    if (traceFiles.length === 1) {
      // Single trace → one result
      const nodes = allTraceNodes[0];
      if (nodes != null) {
        const stem = traceFiles[0]?.name.replace(/\.json$/, '') ?? 'trace';
        results.push({ title: stem, data: buildVizData(nodes) });
      }
    } else {
      // Multiple traces → per-trace results + session aggregate + agent view
      for (const [i, nodes] of allTraceNodes.entries()) {
        const traceId =
          traceFiles[i]?.name.replace(/^trace-/, '').replace(/\.json$/, '') ?? `trace-${String(i)}`;
        results.push({ title: traceId, data: buildVizData(nodes) });
      }
      const sessionNodes = aggregateSession(allTraceNodes);
      results.push({ title: 'session', data: buildVizData(sessionNodes) });
      const agentNodes = aggregateAgent(sessionNodes);
      results.push({ title: 'agent', data: buildVizData(agentNodes) });
    }
  }

  return results;
}
