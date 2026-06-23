// Cross-repo install smoke test for the distributable @coach/mcp package.
//
// Proves the shipping story end to end, OUTSIDE the monorepo: build → `npm pack` →
// `npm install <tarball>` into a fresh temp dir (pulling the externalized real deps
// from the registry) → exercise the installed `coach-mcp` bin:
//   (a) `init --print-only` prints the `claude mcp add coach` registration line
//   (b) `init --project` writes …/.claude/skills/analyze-traces/SKILL.md
//   (c) the server starts over stdio and answers an MCP `tools/list` with the
//       expected tool names.
//
// Run from the repo root: `node --experimental-strip-types scripts/smoke-mcp-install.ts`.
// Set SMOKE_OMIT_OPTIONAL=1 to install with `--omit=optional` if the native
// @duckdb/node-api prebuild can't be fetched in a constrained sandbox (the bin still
// loads it lazily, so init + tools/list work without the native module on disk only
// if duckdb itself isn't imported at startup — see notes printed at the end).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MCP_DIR = join(REPO_ROOT, 'packages', 'mcp');
const HANDSHAKE_TIMEOUT_MS = 20_000;
const INITIALIZE_ID = 1;
const TOOLS_LIST_ID = 2;
const EXPECTED_TOOLS = [
  'load_dataset',
  'describe_schema',
  'query',
  'resolve',
  'subtree',
  'causal_path',
  'open_viz',
];

function run(cmd: string, args: readonly string[], cwd: string): string {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0)
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function pack(): string {
  run('pnpm', ['build'], MCP_DIR);
  const dest = mkdtempSync(join(tmpdir(), 'coach-pack-'));
  const json = run('npm', ['pack', '--json', '--pack-destination', dest], MCP_DIR);
  const parsed = JSON.parse(json) as { filename: string }[];
  const filename = parsed[0]?.filename;
  if (filename == null) throw new Error('npm pack produced no tarball');
  return join(dest, filename);
}

function installTarball(tarball: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'coach-consumer-'));
  run('npm', ['init', '-y'], dir);
  const omitOptional = process.env.SMOKE_OMIT_OPTIONAL === '1' ? ['--omit=optional'] : [];
  run('npm', ['install', ...omitOptional, tarball], dir);
  return dir;
}

function binPath(consumerDir: string): string {
  const bin = join(consumerDir, 'node_modules', '.bin', 'coach-mcp');
  if (!existsSync(bin)) throw new Error(`coach-mcp bin not found at ${bin}`);
  return bin;
}

function assertPrintOnly(bin: string, cwd: string): void {
  const out = run(bin, ['init', '--print-only'], cwd);
  if (!out.includes('claude mcp add coach'))
    throw new Error(`(a) print-only missing registration line:\n${out}`);
  log('(a) init --print-only prints the registration line', out.split('\n')[0] ?? out);
}

function assertProjectInstall(bin: string, cwd: string): void {
  run(bin, ['init', '--project'], cwd);
  const skill = join(cwd, '.claude', 'skills', 'analyze-traces', 'SKILL.md');
  if (!existsSync(skill)) throw new Error(`(b) skill not written to ${skill}`);
  log('(b) init --project wrote the skill', skill);
}

interface JsonRpcResponse {
  readonly id?: number;
  readonly result?: { tools?: { name: string }[] };
}

async function toolsList(bin: string, cwd: string): Promise<string[]> {
  const child = spawn(bin, [], { cwd, stdio: ['pipe', 'pipe', 'inherit'] });
  const send = (msg: unknown): void => {
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  };
  send({
    jsonrpc: '2.0',
    id: INITIALIZE_ID,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '0.0.0' },
    },
  });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: TOOLS_LIST_ID, method: 'tools/list', params: {} });
  return collectToolsList(child);
}

function collectToolsList(child: ReturnType<typeof spawn>): Promise<string[]> {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = '';
    const timeout = setTimeout(() => {
      child.kill();
      rejectPromise(new Error('(c) timed out waiting for tools/list response'));
    }, HANDSHAKE_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const names = parseToolsList(buffer);
      if (names == null) return;
      clearTimeout(timeout);
      child.kill();
      resolvePromise(names);
    });
    child.on('error', rejectPromise);
  });
}

function parseToolsList(buffer: string): string[] | null {
  for (const line of buffer.split('\n')) {
    if (line.trim().length === 0) continue;
    const tools = toolNamesFromLine(line);
    if (tools != null) return tools;
  }
  return null;
}

function toolNamesFromLine(line: string): string[] | null {
  try {
    const msg = JSON.parse(line) as JsonRpcResponse;
    const tools = msg.id === TOOLS_LIST_ID ? msg.result?.tools : undefined;
    return tools != null ? tools.map((t) => t.name) : null;
  } catch {
    return null;
  }
}

function log(label: string, detail: string): void {
  process.stdout.write(`  ✓ ${label}\n      ${detail}\n`);
}

async function main(): Promise<void> {
  process.stdout.write('Cross-repo @coach/mcp install smoke test\n\n');
  const tarball = pack();
  process.stdout.write(`Packed: ${tarball}\n`);
  const consumer = installTarball(tarball);
  process.stdout.write(`Installed into: ${consumer}\n`);
  process.stdout.write(
    `  node_modules/@coach/mcp: ${readdirSync(join(consumer, 'node_modules', '@coach', 'mcp')).join(', ')}\n\n`,
  );
  const bin = binPath(consumer);
  assertPrintOnly(bin, consumer);
  assertProjectInstall(bin, consumer);
  const tools = await toolsList(bin, consumer);
  const missing = EXPECTED_TOOLS.filter((name) => !tools.includes(name));
  if (missing.length > 0) throw new Error(`(c) tools/list missing: ${missing.join(', ')}`);
  log('(c) server started over stdio; tools/list returned', tools.join(', '));
  process.stdout.write('\nALL CHECKS PASSED\n');
}

main().catch((error: unknown) => {
  process.stderr.write(
    `\nSMOKE TEST FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
