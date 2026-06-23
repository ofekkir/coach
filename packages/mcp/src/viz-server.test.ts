import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { outputDir } from './output-dir.ts';
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
    expect(buildVizUrl(4321, '06-enriched-graph.json', { focus: 'node-7' })).toBe(
      'http://localhost:4321/?data=06-enriched-graph.json&focus=node-7',
    );
  });

  it('omits focus when empty', () => {
    expect(buildVizUrl(4321, 'x.json', { focus: '' })).toBe('http://localhost:4321/?data=x.json');
  });

  it('appends both source and dest when given as a pair', () => {
    expect(buildVizUrl(4321, 'x.json', { source: 'a', dest: 'b' })).toBe(
      'http://localhost:4321/?data=x.json&source=a&dest=b',
    );
  });

  it('supports source or dest alone', () => {
    expect(buildVizUrl(4321, 'x.json', { source: 'a' })).toBe(
      'http://localhost:4321/?data=x.json&source=a',
    );
    expect(buildVizUrl(4321, 'x.json', { dest: 'b' })).toBe(
      'http://localhost:4321/?data=x.json&dest=b',
    );
  });

  it('is unchanged with no target', () => {
    expect(buildVizUrl(4321, 'x.json')).toBe('http://localhost:4321/?data=x.json');
  });
});

describe('startVizServer', () => {
  it('errors with a build hint when dist is missing', async () => {
    if (DIST_BUILT) return;
    await expect(startVizServer()).rejects.toThrow(/pnpm --filter @coach\/app build/);
  });

  it('serves dist/index.html and returns a bootable url', async () => {
    if (!DIST_BUILT) return;
    const server = await startVizServer('06-enriched-graph.json', { focus: 'node-1' });
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

// The default data dir is the shared `out/` — the same source of truth the
// session dumps to — so dump-here and read-there cannot drift. Run from a temp
// cwd so the assertion is independent of the repo working tree.
describe('startVizServer default data dir', () => {
  let cwdBefore: string;
  let tmpCwd: string;

  beforeAll(() => {
    cwdBefore = process.cwd();
    tmpCwd = mkdtempSync(join(tmpdir(), 'coach-viz-outdir-test-'));
    process.chdir(tmpCwd);
  });

  afterAll(() => {
    process.chdir(cwdBefore);
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('errors with a load hint when the default out/ dir does not exist', async () => {
    if (!DIST_BUILT) return;
    await expect(startVizServer()).rejects.toThrow(outputDir());
    await expect(startVizServer()).rejects.toThrow(/load_dataset/);
  });
});
