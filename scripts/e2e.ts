import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { log } from '@coach/logger';
import { buildVizResults } from '@coach/pipeline';
import type { UploadedFile, VizResult } from '@coach/pipeline';

const arg = process.argv[2];
if (!arg) {
  log.error(
    'Usage: pnpm e2e <path-or-fixture-name>  (e.g. pnpm e2e fetch-website or pnpm e2e packages/pipeline/fixtures)',
  );
  process.exit(1);
}

const resolved = resolve(process.cwd(), arg);
const fixtureDir = existsSync(resolved)
  ? resolved
  : join(import.meta.dirname, '..', 'packages', 'pipeline', 'fixtures', arg);
const outDir = `out/${basename(fixtureDir)}`;

mkdirSync(outDir, { recursive: true });

function readUploadedFile(filePath: string, rootDir: string): UploadedFile {
  const rel = filePath.startsWith(rootDir + '/')
    ? filePath.slice(rootDir.length + 1)
    : basename(filePath);
  return { name: basename(filePath), content: readFileSync(filePath, 'utf8'), path: rel };
}

function gatherSessionDir(dir: string, rootDir: string): UploadedFile[] {
  return readdirSync(dir)
    .filter((f) => {
      const lower = f.toLowerCase();
      return (
        lower.endsWith('.jsonl') ||
        lower === 'logs.json' ||
        lower === 'trace.json' ||
        (lower.startsWith('trace-') && lower.endsWith('.json'))
      );
    })
    .map((f) => readUploadedFile(join(dir, f), rootDir));
}

function isSessionSubdir(entry: Dirent): boolean {
  if (entry.isDirectory()) return true;
  if (entry.isSymbolicLink()) return statSync(join(fixtureDir, entry.name)).isDirectory();
  return false;
}

const entries = readdirSync(fixtureDir, { withFileTypes: true });
const sessionDirNames = entries
  .filter(isSessionSubdir)
  .map((e) => e.name)
  .sort();

const isMultiSession = sessionDirNames.length > 0;

let allFiles: UploadedFile[];

if (isMultiSession) {
  log.info({ sessions: sessionDirNames.length }, 'multi-session mode');
  allFiles = sessionDirNames.flatMap((name) =>
    gatherSessionDir(join(fixtureDir, name), fixtureDir),
  );
} else {
  allFiles = gatherSessionDir(fixtureDir, fixtureDir);
}

const results: VizResult[] = buildVizResults(allFiles);

if (results.length === 0) {
  log.error('No visualisable results produced. Check the input files.');
  process.exit(1);
}

for (const result of results) {
  const safe = result.title.replace(/[^a-zA-Z0-9_-]/g, '_');
  const jsonPath = `${outDir}/vizdata-${safe}.json`;
  writeFileSync(jsonPath, JSON.stringify(result, null, 2) + '\n');
  log.info({ kind: result.data.kind }, `wrote ${jsonPath}`);
}

log.info(
  `To visualise: pnpm --filter @coach/app dev — then upload the source files from ${fixtureDir}`,
);
