// Pins the dump-here / read-there invariant: a directory `load_dataset` dumps its
// stage artifacts into `<cwd>/out/`, and `startVizServer`'s default data dir
// resolves to that same `out/` — they share `outputDir()` as the single source of
// truth. These tests fail if the dump target reverts to the cwd (the old bug).

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { outputDir } from './output-dir.ts';
import { createSession, type Session } from './session.ts';

const FIXTURE = fileURLToPath(
  new URL('../../pipeline/fixtures/otel/fetch-website', import.meta.url),
);

const DUMPED_FILES = [
  '01-classified.json',
  '02-sessions.json',
  '03-canonical-by-session.json',
  '04-agent-graph.json',
  '05-execution-graph.json',
  '06-enriched-graph.json',
  '07-resolved-graph.json',
  'graph.db',
];

describe('outputDir', () => {
  it('resolves to out/ under the cwd', () => {
    expect(outputDir()).toBe(join(process.cwd(), 'out'));
  });
});

describe('session default dump target', () => {
  let cwdBefore: string;
  let tmpCwd: string;
  let session: Session;

  beforeAll(async () => {
    cwdBefore = process.cwd();
    tmpCwd = mkdtempSync(join(tmpdir(), 'coach-outdir-test-'));
    process.chdir(tmpCwd);
    session = createSession();
    await session.load(FIXTURE);
  });

  afterAll(() => {
    session.close();
    process.chdir(cwdBefore);
    rmSync(tmpCwd, { recursive: true, force: true });
  });

  it('dumps the stage files into out/, not the cwd', () => {
    const outDir = outputDir();
    for (const file of DUMPED_FILES) {
      expect(existsSync(join(outDir, file))).toBe(true);
      expect(existsSync(join(tmpCwd, file))).toBe(false);
    }
  });

  it('dumps into the same out/ dir the viz server reads from by default', () => {
    // The viz server's default data dir and the session dump target share
    // outputDir() — verified here as one source of truth so they cannot drift.
    // (process.cwd() is compared rather than the raw tmp path because macOS
    // resolves /var → /private/var symlinks.)
    expect(outputDir()).toBe(join(process.cwd(), 'out'));
  });
});
