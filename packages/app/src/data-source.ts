import { buildVizResultFromExecutionGraph, buildVizResults } from '@coach/pipeline';
import type { ExecutionGraph, UploadedFile, VizResult } from '@coach/pipeline';

/**
 * Processes uploaded files into visualisable results — entirely in the browser.
 *
 * THIS IS THE SEAM. To move processing to a backend, replace the body of this
 * function with a single fetch call:
 *
 *   const res = await fetch('/api/process', {
 *     method: 'POST',
 *     body: JSON.stringify(files),
 *     headers: { 'Content-Type': 'application/json' },
 *   });
 *   return res.json() as Promise<VizResult[]>;
 *
 * The visualization layer depends only on VizResult / ExecutionGraph — it never imports
 * pipeline internals directly.
 */
export async function processUploads(files: UploadedFile[]): Promise<VizResult[]> {
  // Currently runs the full pipeline synchronously in the browser.
  return Promise.resolve(buildVizResults(files));
}

/**
 * Detects and extracts an ExecutionGraph from an arbitrary parsed JSON value.
 * Accepts a bare ExecutionGraph or any object that contains one under an
 * `executionGraph` key — tolerating the pipeline output shape being reworked.
 */
function extractExecutionGraph(raw: unknown): ExecutionGraph | null {
  const KINDS = new Set(['agent', 'session', 'interaction']);

  function isExecutionGraph(v: unknown): v is ExecutionGraph {
    if (typeof v !== 'object' || v === null) return false;
    const obj = v as { kind?: unknown; data?: unknown };
    return KINDS.has(obj.kind as string) && 'data' in v;
  }

  if (isExecutionGraph(raw)) return raw;

  if (typeof raw === 'object' && raw !== null) {
    const wrapper = raw as { executionGraph?: unknown };
    if (isExecutionGraph(wrapper.executionGraph)) return wrapper.executionGraph;
  }

  return null;
}

/**
 * Parses a JSON string from a pipeline output file (e.g. `05-execution-graph.json`)
 * and returns a VizResult ready for the renderer. The file name (without extension)
 * is used as the visualization title.
 *
 * Throws with a readable message if the JSON is invalid or does not look like an
 * ExecutionGraph.
 */
export function loadPipelineOutput(jsonText: string, fileName: string): VizResult {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText) as unknown;
  } catch {
    throw new Error('Could not parse file — make sure it is valid JSON.');
  }

  const graph = extractExecutionGraph(raw);
  if (!graph) {
    throw new Error(
      'File does not look like an ExecutionGraph. ' +
        'Expected a JSON object with "kind" (agent | session | interaction) and "data", ' +
        'or a pipeline output object containing one under "executionGraph".',
    );
  }

  const title = fileName.replace(/\.json$/i, '');
  return buildVizResultFromExecutionGraph(graph, title);
}
