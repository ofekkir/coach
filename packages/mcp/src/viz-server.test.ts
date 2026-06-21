import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildVizUrl, startVizServer } from './viz-server.ts';

const APP_DIST_INDEX = fileURLToPath(new URL('../../app/dist/index.html', import.meta.url));
const DIST_BUILT = existsSync(APP_DIST_INDEX);

describe('buildVizUrl', () => {
  it('builds a data url with the file name', () => {
    expect(buildVizUrl(4321, '06-enriched-graph.json')).toBe(
      'http://localhost:4321/?data=06-enriched-graph.json',
    );
  });

  it('appends the focus node id when given', () => {
    expect(buildVizUrl(4321, '06-enriched-graph.json', 'node-7')).toBe(
      'http://localhost:4321/?data=06-enriched-graph.json&focus=node-7',
    );
  });

  it('omits focus when empty', () => {
    expect(buildVizUrl(4321, 'x.json', '')).toBe('http://localhost:4321/?data=x.json');
  });
});

describe('startVizServer', () => {
  it('errors with a build hint when dist is missing', async () => {
    if (DIST_BUILT) return;
    await expect(startVizServer()).rejects.toThrow(/pnpm --filter @coach\/app build/);
  });

  it('serves dist/index.html and returns a bootable url', async () => {
    if (!DIST_BUILT) return;
    const server = await startVizServer('06-enriched-graph.json', 'node-1');
    try {
      expect(server.url).toMatch(
        /^http:\/\/localhost:\d+\/\?data=06-enriched-graph\.json&focus=node-1$/,
      );
      const res = await fetch(new URL(server.url).origin + '/');
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('id="root"');
    } finally {
      server.close();
    }
  });
});
