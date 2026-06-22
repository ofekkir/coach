// A tiny dependency-free static server for the visualization. It serves the built
// `@coach/app` (packages/app/dist) plus the stage JSON files dumped into the cwd by
// a directory `load_dataset`, then hands back a URL that boots the app pointed at a
// chosen data file (and optional focus node). No framework: just `node:http`.

import { existsSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DATA_FILE = '06-enriched-graph.json';

// packages/mcp/src/viz-server.ts → packages/app/dist
const APP_DIST = fileURLToPath(new URL('../../app/dist', import.meta.url));
const INDEX_HTML = 'index.html';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;

const MISSING_DIST_HINT = `viz: built app not found at ${APP_DIST} — run \`pnpm --filter @coach/app build\` first.`;

/** Builds the boot URL for a running server: the app reads `data`/`focus` from the
 *  query string (see app `main.tsx`). Pure — tested without a live server. */
export function buildVizUrl(port: number, dataFile: string, focus?: string): string {
  const params = new URLSearchParams({ data: dataFile });
  if (focus != null && focus.length > 0) params.set('focus', focus);
  return `http://localhost:${String(port)}/?${params.toString()}`;
}

function contentType(filePath: string): string {
  return MIME_TYPES[extname(filePath)] ?? 'application/octet-stream';
}

// Maps a request path to a file: a dumped JSON file is served from the cwd; every
// other path is served from the built app (with `/` → index.html). Both are
// constrained to their root so a `..` path can't escape it.
function resolveRequestFile(urlPath: string, dataDir: string): string | null {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  if (clean === '/' || clean === '') return join(APP_DIST, INDEX_HTML);
  if (clean.endsWith('.json')) {
    const inData = resolve(dataDir, `.${clean}`);
    return inData.startsWith(resolve(dataDir)) ? inData : null;
  }
  const inDist = resolve(APP_DIST, `.${clean}`);
  return inDist.startsWith(resolve(APP_DIST)) ? inDist : null;
}

function handleRequest(req: IncomingMessage, res: ServerResponse, dataDir: string): void {
  const urlPath = new URL(req.url ?? '/', 'http://localhost').pathname;
  const filePath = resolveRequestFile(urlPath, dataDir);
  if (filePath == null || !existsSync(filePath)) {
    res.writeHead(HTTP_NOT_FOUND, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  res.writeHead(HTTP_OK, { 'content-type': contentType(filePath) });
  res.end(readFileSync(filePath));
}

export interface VizServer {
  readonly url: string;
  close(): void;
}

/** Starts the static server on an ephemeral port serving the built app + the
 *  dumped JSON from `dataDir` (defaults to the cwd), then resolves the boot URL.
 *  Throws a build hint if the app `dist` is missing. */
export function startVizServer(
  dataFile: string = DEFAULT_DATA_FILE,
  focus?: string,
  dataDir: string = process.cwd(),
): Promise<VizServer> {
  return new Promise((resolvePromise, rejectPromise) => {
    if (!existsSync(join(APP_DIST, INDEX_HTML))) {
      rejectPromise(new Error(MISSING_DIST_HINT));
      return;
    }
    const server = createServer((req, res) => {
      handleRequest(req, res, dataDir);
    });
    server.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolvePromise({ url: buildVizUrl(port, dataFile, focus), close: () => server.close() });
    });
  });
}
