import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { log } from '@coach/logger';
import { buildVizResults } from '@coach/pipeline';
import type { UploadedFile, VizResult } from '@coach/pipeline';

const arg = process.argv[2];
if (!arg) {
  log.error('Usage: pnpm e2e <path>  (e.g. pnpm e2e packages/pipeline/fixtures/fetch-website)');
  process.exit(1);
}

const inputDir = resolve(process.cwd(), arg);
const outDir = `out/${basename(inputDir)}`;

mkdirSync(outDir, { recursive: true });

function gatherFiles(dir: string, rootDir: string): UploadedFile[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return gatherFiles(fullPath, rootDir);
    const lower = entry.name.toLowerCase();
    if (!lower.endsWith('.jsonl') && !lower.endsWith('.json')) return [];
    const rel = fullPath.startsWith(rootDir + '/')
      ? fullPath.slice(rootDir.length + 1)
      : entry.name;
    return [{ name: entry.name, content: readFileSync(fullPath, 'utf8'), path: rel }];
  });
}

const allFiles = gatherFiles(inputDir, inputDir);
log.info({ files: allFiles.length }, 'gathered input files');

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
  `To visualise: pnpm --filter @coach/app dev — then upload the source files from ${inputDir}`,
);
