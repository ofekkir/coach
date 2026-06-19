import { readFileSync, readdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildVizResults, type UploadedFile } from '@coach/pipeline';
import { createServer, type CoachServer } from './index.ts';
import type { LoadSummary } from './session.ts';

const FIXTURE = fileURLToPath(
  new URL('../../pipeline/fixtures/otel/fetch-website', import.meta.url),
);
const JSON_HEADERS = { 'Content-Type': 'application/json' };

function fixtureFiles(): UploadedFile[] {
  return readdirSync(FIXTURE).map((name) => ({
    name,
    content: readFileSync(join(FIXTURE, name), 'utf8'),
  }));
}

function listen(coach: CoachServer): Promise<string> {
  return new Promise((resolve) => {
    coach.server.listen(0, () => {
      const { port } = coach.server.address() as AddressInfo;
      resolve(`http://localhost:${String(port)}`);
    });
  });
}

const post = (base: string, path: string, body: unknown): Promise<Response> =>
  fetch(`${base}${path}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });

describe('coach HTTP server', () => {
  let coach: CoachServer;
  let base: string;
  const files = fixtureFiles();

  beforeAll(async () => {
    coach = createServer();
    base = await listen(coach);
    await post(base, '/api/load', { files });
  });

  afterAll(() => {
    coach.close();
  });

  it('loads a dataset and reports a summary', async () => {
    const res = await post(base, '/api/load', { files });
    expect(res.status).toBe(200);
    const summary = (await res.json()) as LoadSummary;
    expect(summary.nodes).toBeGreaterThan(0);
    expect(summary.sessions).toBeGreaterThan(0);
    expect(summary.interactions).toBeGreaterThan(0);
  });

  it('answers read-only SQL over the loaded graph', async () => {
    const res = await post(base, '/api/query', { sql: 'SELECT count(*) AS n FROM nodes' });
    expect(res.status).toBe(200);
    const result = (await res.json()) as { rows: { n: number }[] };
    expect(Number(result.rows[0]?.n)).toBeGreaterThan(0);
  });

  it('serves a view that deep-equals buildVizResults on the same input', async () => {
    const res = await fetch(`${base}/api/view`);
    const view = await res.json();
    expect(view).toEqual(JSON.parse(JSON.stringify(buildVizResults(files))));
  });

  it('rejects bad SQL with 400, not 500', async () => {
    const res = await post(base, '/api/query', { sql: 'DROP TABLE nodes' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown route', async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
  });

  it('returns 409 when querying before any dataset is loaded', async () => {
    const fresh = createServer();
    const freshBase = await listen(fresh);
    const res = await post(freshBase, '/api/query', { sql: 'SELECT 1' });
    expect(res.status).toBe(409);
    fresh.close();
  });
});
