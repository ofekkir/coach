import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleSemanticsConfig,
  type AgentSemantics,
  type Ontology,
  type ProjectGrounding,
  type SemanticsConfig,
} from '@coach/pipeline';

// The file-system seam: the pure pipeline never reads config from disk. This CLI
// loader parses the config/ artifacts (ontology + agent + project) and assembles
// the validated SemanticsConfig that runPipelineAsync's enrichment requires.

const CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'config');

function readJson(relativePath: string): unknown {
  return JSON.parse(readFileSync(join(CONFIG_DIR, relativePath), 'utf8'));
}

/**
 * Loads and validates the semantics config for a given domain/agent/project.
 * Defaults match the only triple currently authored: coding × claude-code × coach.
 * `assembleSemanticsConfig` throws if the agent/project files reference any
 * action/object id absent from the ontology.
 */
export function loadSemanticsConfig(
  domain = 'coding',
  agent = 'claude-code',
  project: string | null = 'coach',
): SemanticsConfig {
  const ontology = readJson(`ontology/${domain}.json`) as Ontology;
  const agentSemantics = readJson(`agents/${agent}.json`) as AgentSemantics;
  const grounding =
    project != null ? (readJson(`projects/${project}.json`) as ProjectGrounding) : undefined;
  return assembleSemanticsConfig(ontology, agentSemantics, grounding);
}
