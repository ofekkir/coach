#!/usr/bin/env -S node --experimental-strip-types
// `coach-viz [data-file] [focus-node-id] [--source <id>] [--dest <id>]` — serves
// the built `@coach/app` plus the stage JSON dumped into the cwd (by `pnpm e2e` or
// a directory `load_dataset`), opens the browser at the boot URL, and keeps serving
// until interrupted. Defaults the data file to `06-enriched-graph.json`. Use
// `--source`/`--dest` to highlight a related pair instead of focusing one node.
// Errors with a build hint if the app `dist` is missing. Diagnostics go to stderr.

import { spawn } from 'node:child_process';
import { platform } from 'node:os';

import { startVizServer } from '../src/viz-server.ts';

const DEFAULT_DATA_FILE = '06-enriched-graph.json';
// argv[0]=node, argv[1]=script; user args start at index 2.
const FIRST_USER_ARG = 2;

function flagValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function positionals(): string[] {
  const args = process.argv.slice(FIRST_USER_ARG);
  const out: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg == null) continue;
    if (arg.startsWith('--')) i += 1;
    else out.push(arg);
  }
  return out;
}

const [dataFileArg, focus] = positionals();
const dataFile = dataFileArg ?? DEFAULT_DATA_FILE;
const target = { focus, source: flagValue('--source'), dest: flagValue('--dest') };

const OPEN_COMMANDS: Record<string, string> = {
  darwin: 'open',
  win32: 'start',
  linux: 'xdg-open',
};

// Best-effort browser open; if it can't, the printed URL still works.
function openBrowser(url: string): void {
  const command = OPEN_COMMANDS[platform()];
  if (command == null) return;
  try {
    spawn(command, [url], {
      stdio: 'ignore',
      detached: true,
      shell: platform() === 'win32',
    }).unref();
  } catch {
    /* the URL is already printed — opening is a convenience, not a requirement */
  }
}

const { url } = await startVizServer(dataFile, target).catch((error: unknown) => {
  process.stderr.write(`coach-viz: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});

process.stderr.write(`coach-viz: serving ${url}\n`);
openBrowser(url);
