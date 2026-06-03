import { buildVizResults } from '@coach/pipeline';
import type { UploadedFile, VizResult } from '@coach/pipeline';

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
 * The visualization layer depends only on VizResult / GraphData — it never imports
 * pipeline internals directly.
 */
export async function processUploads(files: UploadedFile[]): Promise<VizResult[]> {
  // Currently runs the full pipeline synchronously in the browser.
  return Promise.resolve(buildVizResults(files));
}
