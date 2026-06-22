#!/usr/bin/env -S node --experimental-strip-types
// Why: this DuckDB is a throwaway SQL snapshot for ad-hoc inspection in the duckdb
// CLI — the MCP server never loads it, it re-derives the query tables from source.

import { mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { writePersistedDb } from '../src/duckdb.ts';
import { loadDataset } from '../src/load.ts';

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
