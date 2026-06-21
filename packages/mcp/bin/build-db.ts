#!/usr/bin/env -S node --experimental-strip-types
// `coach-build-db <traces-dir> [out.db]` — runs the pipeline over a directory of
// trace/native files and writes a self-contained, queryable DuckDB the MCP can load
// untouched (`load_dataset <out.db>`). Defaults the output to `out/<dir-name>.db`.
// Diagnostics go to stderr.

import { mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { loadDataset } from '../src/load.ts';
import { writePersistedDb } from '../src/duckdb.ts';

const dir = process.argv[2];
if (dir == null || dir.length === 0) {
  process.stderr.write('usage: coach-build-db <traces-dir> [out.db]\n');
  process.exit(1);
}

const out = process.argv[3] ?? join('out', `${basename(dir)}.db`);

mkdirSync(dirname(out), { recursive: true });
const { graph } = loadDataset(dir);
await writePersistedDb(graph, out);
process.stderr.write(`coach-build-db: wrote ${out}\n`);
