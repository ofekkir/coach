// The `coach-mcp` command-line front door. Two modes:
//   coach-mcp [dataset-dir]   → serve the analyst tools over stdio (the MCP server)
//   coach-mcp init [flags]     → install the bundled analyze-traces skill into the
//                                user's skills dir and print the `claude mcp add` line
//
// `init` is what makes coach installable in a third party's agent without cloning the
// monorepo: it copies the shipped SKILL.md and tells the user the exact registration
// command pointing at the installed `coach-mcp` bin. Filesystem writes are guarded —
// directories are created as needed and an existing skill is never clobbered without
// `--force`. Diagnostics and the registration line go to stdout (init is interactive);
// the server keeps stdout for JSON-RPC and logs to stderr.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serveStdio } from '../server.ts';

const SKILL_NAME = 'analyze-traces';
const SKILL_FILE = 'SKILL.md';

/** Default dataset directory when the user runs `coach-mcp` with no path: their own
 *  Claude Code session logs, the most likely first thing to analyze. */
const DEFAULT_DATASET_DIR = join(homedir(), '.claude', 'projects');

export interface InitOptions {
  /** Install into `./.claude/skills` instead of `~/.claude/skills`. */
  readonly project: boolean;
  /** Overwrite an existing skill file. */
  readonly force: boolean;
  /** Only print the registration line; do not write any files. */
  readonly printOnly: boolean;
  /** Override the home dir / cwd resolution (tests). */
  readonly homeDir?: string;
  readonly cwd?: string;
}

/** Absolute path to the bundled skill source shipped inside this package. Both the
 *  built bin (`dist/bin/mcp.js`) and the dev source (`src/cli/cli.ts`) sit two levels
 *  below the package root, where `skills/` is published via `package.json#files`, so
 *  `../../skills/<name>` resolves in both. A couple of fallbacks keep it robust to a
 *  flattened dist layout. */
export function bundledSkillDir(moduleUrl: string = import.meta.url): string {
  const here = dirname(fileURLToPath(moduleUrl));
  const fallback = resolve(here, '..', '..', 'skills', SKILL_NAME);
  const candidates = [
    fallback,
    resolve(here, '..', 'skills', SKILL_NAME),
    resolve(here, '..', '..', '..', 'skills', SKILL_NAME),
  ];
  return candidates.find((dir) => existsSync(join(dir, SKILL_FILE))) ?? fallback;
}

function skillsRoot(options: InitOptions): string {
  const home = options.homeDir ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  return options.project ? join(cwd, '.claude', 'skills') : join(home, '.claude', 'skills');
}

/** The `claude mcp add` line registering coach, pointing at the installed bin (the
 *  `coach-mcp` command on PATH by default). */
export function registrationLine(binPath = 'coach-mcp'): string {
  return `claude mcp add coach -- ${binPath}`;
}

const DATASET_NOTE =
  'Append an absolute traces directory to preload it, e.g. `claude mcp add coach -- coach-mcp /ABS/PATH/TO/traces`; ' +
  'omit it to load at runtime with the load_dataset tool (default discovery: ~/.claude/projects).';

export interface InitResult {
  readonly installed: boolean;
  readonly skillPath: string;
  readonly registration: string;
  readonly message: string;
}

function installSkill(options: InitOptions): {
  installed: boolean;
  skillPath: string;
  note: string;
} {
  const destDir = join(skillsRoot(options), SKILL_NAME);
  const destFile = join(destDir, SKILL_FILE);
  if (existsSync(destFile) && !options.force)
    return {
      installed: false,
      skillPath: destFile,
      note: `skill already present at ${destFile} — pass --force to overwrite (left untouched).`,
    };
  mkdirSync(destDir, { recursive: true });
  copyFileSync(join(bundledSkillDir(), SKILL_FILE), destFile);
  return {
    installed: true,
    skillPath: destFile,
    note: `installed analyze-traces skill → ${destFile}`,
  };
}

/** Runs `init`: (optionally) installs the skill and returns the registration line. */
export function runInit(options: InitOptions): InitResult {
  const registration = registrationLine();
  if (options.printOnly)
    return {
      installed: false,
      skillPath: join(skillsRoot(options), SKILL_NAME, SKILL_FILE),
      registration,
      message: `${registration}\n\n${DATASET_NOTE}`,
    };
  const { installed, skillPath, note } = installSkill(options);
  return {
    installed,
    skillPath,
    registration,
    message: `${note}\n\nRegister the server with your agent:\n  ${registration}\n\n${DATASET_NOTE}`,
  };
}

const HELP = `coach-mcp — distributable analyst MCP server for agent traces

Usage:
  coach-mcp [dataset-dir]        Serve the analyst tools over stdio (MCP server).
                                 With no dataset-dir, load data at runtime via the
                                 load_dataset tool (default discovery: ~/.claude/projects).
  coach-mcp init [options]       Install the bundled analyze-traces skill and print the
                                 \`claude mcp add\` registration line.
  coach-mcp --help               Show this help.

init options:
  --project        Install into ./.claude/skills instead of ~/.claude/skills.
  --force          Overwrite an existing skill file (never clobbers without this).
  --print-only     Only print the registration line; write no files.
`;

function parseInitOptions(args: readonly string[]): InitOptions {
  return {
    project: args.includes('--project'),
    force: args.includes('--force'),
    printOnly: args.includes('--print-only'),
  };
}

function hasEntries(dir: string): boolean {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/** The dataset to preload when none is passed. Defaults to the user's own Claude Code
 *  logs (`~/.claude/projects`) when that directory exists and is non-empty; otherwise
 *  nothing is preloaded and the agent loads data at runtime via `load_dataset`. The
 *  resolution is logged to stderr (stdout is the JSON-RPC channel). */
function resolveStartupDataset(explicit?: string): string | undefined {
  if (explicit != null && explicit.length > 0) return explicit;
  if (hasEntries(DEFAULT_DATASET_DIR)) {
    process.stderr.write(`coach-mcp: no dataset arg — preloading default ${DEFAULT_DATASET_DIR}\n`);
    return DEFAULT_DATASET_DIR;
  }
  process.stderr.write(
    `coach-mcp: no dataset arg and no logs at ${DEFAULT_DATASET_DIR} — call the load_dataset tool with a directory.\n`,
  );
  return undefined;
}

/** CLI entry: dispatch `init` / `--help`, otherwise serve over stdio. */
export async function runCli(argv: readonly string[]): Promise<void> {
  const [first, ...rest] = argv;
  if (first === '--help' || first === '-h') {
    process.stdout.write(HELP);
    return;
  }
  if (first === 'init') {
    process.stdout.write(`${runInit(parseInitOptions(rest)).message}\n`);
    return;
  }
  await serveStdio(resolveStartupDataset(first));
}
