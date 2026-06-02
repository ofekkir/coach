import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', 'packages');
const violations: string[] = [];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'fixtures', 'src', 'lib', '__tests__']);

function checkTestPlacement(dir: string, entry: string, siblings: Set<string>): void {
  const testMatch = /^(.+)\.test\.ts$/.exec(entry);
  if (!testMatch) return;
  const moduleName = testMatch[1];
  if (moduleName != null && siblings.has(moduleName)) {
    violations.push(
      `${relative(ROOT, join(dir, entry))}: test file is a sibling of '${moduleName}/'. Move it inside.`,
    );
  }
}

function shouldVisit(name: string): boolean {
  return !SKIP_DIRS.has(name) && !name.startsWith('.');
}

function checkDir(dir: string): void {
  const entries = readdirSync(dir);
  const siblings = new Set(entries);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (!statSync(fullPath).isDirectory()) {
      checkTestPlacement(dir, entry, siblings);
      continue;
    }
    if (!shouldVisit(entry)) continue;
    checkModuleDir(entry, fullPath);
    checkDir(fullPath);
  }
}

function checkModuleDir(name: string, fullPath: string): void {
  const children = readdirSync(fullPath);
  const hasNamedFile = children.some((c) => c === `${name}.ts` || c === `${name}.tsx`);
  if (children.includes('index.ts') && !hasNamedFile) {
    const rel = relative(ROOT, fullPath);
    violations.push(
      `${rel}/index.ts: rename to ${rel}/${name}.ts (index.ts should be a barrel, not the logic file).`,
    );
  }
}

checkDir(ROOT);

if (violations.length > 0) {
  process.stderr.write('Structure violations:\n');
  for (const v of violations) process.stderr.write(`  • ${v}\n`);
  process.exit(1);
}
