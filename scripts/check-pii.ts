import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Fails CI if author-identifying PII or origin-specific content leaks into the
// committed tree. Patterns are scrubbed everywhere EXCEPT the fixtures dir, which
// still holds raw captured sessions; that exclusion is removed once the fixtures
// are regenerated synthetically (see RELEASE-CHECKLIST.md). A line carrying the
// `pii-allow` marker is skipped, so this file and the checklist can name the terms.

const ROOT = join(import.meta.dirname, '..');

// Until the fixtures are regenerated, their raw captured content is exempt.
const EXCLUDED_PREFIXES = ['packages/pipeline/fixtures/'];

// Binary / vendored files we never scan.
const SKIP_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.lock'];
const SKIP_FILES = ['pnpm-lock.yaml'];

const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: 'author email', pattern: /ofekkir@gmail\.com/i }, // pii-allow
  { label: 'home path', pattern: /\/Users\/ofek\b/ }, // pii-allow
  { label: 'encoded home path', pattern: /-Users-ofek-/ }, // pii-allow
  { label: 'origin site (ynet)', pattern: /\bynet\b/i }, // pii-allow
  { label: 'origin TLD (.co.il)', pattern: /\.co\.il/i }, // pii-allow
  { label: 'origin (israel)', pattern: /\bisrael/i }, // pii-allow
  { label: 'origin language (hebrew)', pattern: /\bhebrew\b/i }, // pii-allow
  { label: 'personal project (yb4)', pattern: /\byb4\b/i }, // pii-allow
];

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

function isScannable(path: string): boolean {
  if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  if (SKIP_FILES.includes(path)) return false;
  if (SKIP_EXTENSIONS.some((ext) => path.endsWith(ext))) return false;
  if (path === 'scripts/check-pii.ts') return false;
  return true;
}

function scanFile(path: string): string[] {
  const fullPath = join(ROOT, path);
  if (!statSync(fullPath).isFile()) return []; // skip submodule / gitlink entries
  const lines = readFileSync(fullPath, 'utf8').split('\n');
  const hits: string[] = [];
  lines.forEach((line, index) => {
    if (line.includes('pii-allow')) return;
    for (const { label, pattern } of FORBIDDEN) {
      if (pattern.test(line)) hits.push(`${path}:${String(index + 1)} — ${label}`);
    }
  });
  return hits;
}

const violations = trackedFiles().filter(isScannable).flatMap(scanFile);

if (violations.length > 0) {
  process.stderr.write('PII / origin leak detected:\n');
  for (const v of violations) process.stderr.write(`  • ${v}\n`);
  process.stderr.write(
    '\nScrub the value, or add a `pii-allow` marker on the line if it is an intentional reference.\n',
  );
  process.exit(1);
}
