#!/usr/bin/env node --experimental-strip-types
// Render a Mermaid state-machine (.mmd) to PNG. Portable: locates a system
// Chromium for mermaid-cli's puppeteer so it works without its bundled browser.
//
//   node --experimental-strip-types render-mermaid.ts <input.mmd> <output.png> [scale]
import { existsSync, mkdirSync, writeFileSync, accessSync, constants } from 'node:fs';
import { dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const [input, output, scaleArg] = process.argv.slice(2);
if (input == null || output == null) {
  console.error('usage: render-mermaid.ts <input.mmd> <output.png> [scale]');
  process.exit(1);
}
const scale = scaleArg ?? '3';
const outDir = dirname(output);
mkdirSync(outDir, { recursive: true });

const isExecutable = (p: string): boolean => {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const which = (cmd: string): string | undefined => {
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  const p = r.stdout.trim();
  return p.length > 0 ? p : undefined;
};

const findChrome = (): string | undefined => {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    which('google-chrome'),
    which('chromium'),
    which('chromium-browser'),
  ];
  return candidates.find((c): c is string => c != null && existsSync(c) && isExecutable(c));
};

const chrome = findChrome();
const ppFlags: string[] = [];
if (chrome != null) {
  const pp = `${outDir}/.puppeteer.json`;
  writeFileSync(pp, JSON.stringify({ executablePath: chrome, args: ['--no-sandbox'] }));
  ppFlags.push('-p', pp);
} else {
  console.error("no system Chrome found; relying on mermaid-cli's bundled browser");
}

const args = [
  'dlx',
  '@mermaid-js/mermaid-cli',
  '-i',
  input,
  '-o',
  output,
  '-t',
  'neutral',
  '-b',
  'white',
  '--scale',
  scale,
  ...ppFlags,
];
const result = spawnSync('pnpm', args, { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`rendered: ${output}`);
