// Thin node:http adapter over the route handlers. Parses the request (URL + JSON
// body), applies permissive CORS for local dev, and maps HttpError→status (any
// other throw→500). The app's data-source seam talks to these /api/* routes; a
// Service Worker can later answer the same routes locally (see the plan doc).

import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import { createServerSession, type ServerSession } from './session.ts';
import { handleRequest, HttpError } from './routes.ts';

export interface CoachServer {
  readonly server: Server;
  close(): void;
}

const STATUS_BAD_REQUEST = 400;
const STATUS_NO_CONTENT = 204;
const STATUS_SERVER_ERROR = 500;
const ORIGIN = 'http://localhost';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const JSON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  ...CORS_HEADERS,
};

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(STATUS_BAD_REQUEST, 'invalid JSON body');
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(body));
}

async function respond(
  session: ServerSession,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', ORIGIN);
  const method = req.method ?? 'GET';
  const body = method === 'POST' ? await readJson(req) : undefined;
  const result = await handleRequest(session, method, url.pathname, url.searchParams, body);
  sendJson(res, result.status, result.body);
}

function onRequest(session: ServerSession, req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'OPTIONS') {
    res.writeHead(STATUS_NO_CONTENT, CORS_HEADERS);
    res.end();
    return;
  }
  respond(session, req, res).catch((error: unknown) => {
    const status = error instanceof HttpError ? error.status : STATUS_SERVER_ERROR;
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, status, { error: message });
  });
}

/** Creates the HTTP server (not yet listening) plus a `close` that also frees the
 *  loaded dataset's DuckDB store. Point the app's data-source at its `/api/*`. */
export function createServer(): CoachServer {
  const session = createServerSession();
  const server = createHttpServer((req, res) => {
    onRequest(session, req, res);
  });
  return {
    server,
    close: () => {
      server.close();
      session.close();
    },
  };
}
