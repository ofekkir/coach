// HTTP route handlers over a ServerSession. Pure request→response logic (no socket
// or framework) so server.ts stays a thin node:http adapter and the routing is
// unit-testable. Handlers throw HttpError(status, message); the adapter maps an
// HttpError to its status and any other throw to 500. Read-only enforcement and
// result caps come for free from the Store.

import type { CausalDirection, QueryResult, Store } from '@coach/mcp';
import type { UploadedFile } from '@coach/pipeline';
import type { ServerSession } from './session.ts';

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const STATUS_OK = 200;
const STATUS_BAD_REQUEST = 400;
const STATUS_NOT_FOUND = 404;
const STATUS_CONFLICT = 409;

const NOT_LOADED = 'no dataset loaded — POST /api/load first';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ── Input validation ──────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toUploadedFile(value: unknown): UploadedFile {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.content !== 'string')
    throw new HttpError(STATUS_BAD_REQUEST, 'each file needs a string name and content');
  return { name: value.name, content: value.content };
}

function filesField(body: unknown): UploadedFile[] {
  if (!isRecord(body) || !Array.isArray(body.files))
    throw new HttpError(STATUS_BAD_REQUEST, 'body must be { files: [{ name, content }] }');
  return body.files.map(toUploadedFile);
}

function stringField(body: unknown, key: string): string {
  const value = isRecord(body) ? body[key] : undefined;
  if (typeof value !== 'string' || value.length === 0)
    throw new HttpError(STATUS_BAD_REQUEST, `'${key}' must be a non-empty string`);
  return value;
}

function requiredParam(query: URLSearchParams, key: string): string {
  const value = query.get(key);
  if (value == null || value.length === 0)
    throw new HttpError(STATUS_BAD_REQUEST, `'${key}' query param is required`);
  return value;
}

function causalDirection(query: URLSearchParams): CausalDirection {
  const value = query.get('direction') ?? 'upstream';
  if (value !== 'upstream' && value !== 'downstream')
    throw new HttpError(STATUS_BAD_REQUEST, "'direction' must be 'upstream' or 'downstream'");
  return value;
}

// ── Store access ──────────────────────────────────────────────────────────────

function requireStore(session: ServerSession): Store {
  try {
    return session.store();
  } catch {
    throw new HttpError(STATUS_CONFLICT, NOT_LOADED);
  }
}

async function runStore(fn: () => Promise<QueryResult>): Promise<HttpResponse> {
  try {
    return { status: STATUS_OK, body: await fn() };
  } catch (error) {
    // A guard/engine rejection is a client error (bad SQL), not a server fault.
    throw new HttpError(STATUS_BAD_REQUEST, messageOf(error));
  }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

interface RouteCtx {
  readonly session: ServerSession;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

async function handleLoad(ctx: RouteCtx): Promise<HttpResponse> {
  const files = filesField(ctx.body);
  try {
    return { status: STATUS_OK, body: await ctx.session.load(files) };
  } catch (error) {
    // Bad/unparseable upload is a client error, not a server fault.
    throw new HttpError(STATUS_BAD_REQUEST, messageOf(error));
  }
}

function handleView(ctx: RouteCtx): HttpResponse {
  try {
    return { status: STATUS_OK, body: ctx.session.views() };
  } catch {
    throw new HttpError(STATUS_CONFLICT, NOT_LOADED);
  }
}

function handleQuery(ctx: RouteCtx): Promise<HttpResponse> {
  const sql = stringField(ctx.body, 'sql');
  const store = requireStore(ctx.session);
  return runStore(() => store.query(sql));
}

function handleSubtree(ctx: RouteCtx): Promise<HttpResponse> {
  const id = requiredParam(ctx.query, 'id');
  const store = requireStore(ctx.session);
  return runStore(() => store.subtree(id));
}

function handleCausal(ctx: RouteCtx): Promise<HttpResponse> {
  const id = requiredParam(ctx.query, 'id');
  const direction = causalDirection(ctx.query);
  const store = requireStore(ctx.session);
  return runStore(() => store.causalPath(id, direction));
}

type RouteHandler = (ctx: RouteCtx) => HttpResponse | Promise<HttpResponse>;

const ROUTES: Record<string, RouteHandler> = {
  'POST /api/load': handleLoad,
  'GET /api/view': handleView,
  'POST /api/query': handleQuery,
  'GET /api/subtree': handleSubtree,
  'GET /api/causal': handleCausal,
};

/** Routes one parsed request to its handler. Throws HttpError; the adapter maps
 *  HttpError→status and any other error→500. */
export function handleRequest(
  session: ServerSession,
  method: string,
  pathname: string,
  query: URLSearchParams,
  body: unknown,
): Promise<HttpResponse> {
  const handler = ROUTES[`${method} ${pathname}`];
  if (handler == null) throw new HttpError(STATUS_NOT_FOUND, `no route for ${method} ${pathname}`);
  return Promise.resolve(handler({ session, query, body }));
}
