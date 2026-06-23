import { strField, type SemanticsConfig } from '@coach/semantics';

import { stripWorktreeSegment } from '../../db/repo-path.ts';
import type { SemanticContext } from '../../types.ts';

import { toolSpecFor } from './tool-intent.ts';

// ════════════════════════════════════════════════════════════════════════════
// Structured `what`-context — the package/file/url the `what` phrase used to
// flatten into a `(package=…)` parenthetical or a folded basename. Promoted to
// machine-readable data so a consumer can read the package/file/url directly.
// Driven entirely by the tool's configured `target` (no hardcoded tool tables).
// ════════════════════════════════════════════════════════════════════════════

// The structure-convention qualifier whose captured value is the workspace package.
const STRUCTURE_PACKAGE_QUALIFIER = 'package';

/** The `package` structural qualifier value deduced from layout conventions — the
 *  monorepo workspace a path lives in (e.g. `pipeline`). Promoted to structured
 *  `context.package` rather than flattened into the `what` phrase. */
function structurePackage(config: SemanticsConfig, path: string): string | undefined {
  const rules = config.ontology.conventions?.structure?.rules ?? [];
  const rule = rules.find((r) => r.qualifier === STRUCTURE_PACKAGE_QUALIFIER);
  if (rule == null) return undefined;
  const captured = new RegExp(rule.match, 'i').exec(path)?.[1];
  return captured != null && captured !== '' ? captured : undefined;
}

function pathContext(config: SemanticsConfig, rawPath: string): SemanticContext | undefined {
  const file = stripWorktreeSegment(rawPath);
  if (file === '') return undefined;
  const pkg = structurePackage(config, file);
  return pkg != null ? { file, package: pkg } : { file };
}

/** Structured context for a tool call. Driven by the tool's configured `target`: a
 *  `path` target yields `file` (worktree-normalized) + deduced `package`; a `host`
 *  target yields the raw `url`. Undefined when no path/host target or empty field. */
export function toolContext(
  config: SemanticsConfig,
  name: string | undefined,
  input: Record<string, unknown>,
): SemanticContext | undefined {
  const spec = toolSpecFor(config, name)?.target;
  if (spec?.field == null) return undefined;
  const raw = strField(input, spec.field).trim();
  if (raw === '') return undefined;
  if (spec.kind === 'path') return pathContext(config, raw);
  if (spec.kind === 'host') return { url: raw };
  return undefined;
}
