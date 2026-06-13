import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleSemanticsConfig, type SemanticsConfig } from '@coach/pipeline';

// The file-system seam: the pure pipeline never reads config from disk. This CLI
// loader reads the config/ artifacts (ontology + agent + project) and hands the
// raw JSON to assembleSemanticsConfig, which Zod-validates each file and assembles
// the SemanticsConfig that runPipelineAsync's enrichment requires.

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'config');

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(CONFIG_DIR, relativePath), 'utf8'));
}

/**
 * Loads and validates the semantics config for a given domain/agent/project.
 * Defaults match the only triple currently authored: coding × claude-code × coach.
 * `assembleSemanticsConfig` throws (Zod or referential-integrity error) on any
 * invalid file or any action/object id absent from the ontology.
 */
export function loadSemanticsConfig(
  domain = 'coding',
  agent = 'claude-code',
  project: string | null = 'coach',
): SemanticsConfig {
  return assembleSemanticsConfig(
    readJson(`ontology/${domain}.json`),
    readJson(`agents/${agent}.json`),
    project != null ? readJson(`projects/${project}.json`) : undefined,
  );
}
