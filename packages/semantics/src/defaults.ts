import { assembleSemanticsConfig, type SemanticsConfig } from './config.ts';
import claudeCodeAgent from './data/agents/claude-code.json' with { type: 'json' };
import codingOntology from './data/ontology/coding.json' with { type: 'json' };

// Why: importing (not disk-reading) the bundled JSON keeps this
// module pure and browser-safe: the bundler inlines the data, so the pipeline
// orchestrator and the app share one assembled config with no file-system seam.
// Assembly runs at module load; a malformed artifact throws here (Zod or
// referential-integrity), so a broken config fails fast at import rather than mid-run.
export const defaultSemanticsConfig: SemanticsConfig = assembleSemanticsConfig(
  codingOntology,
  claudeCodeAgent,
);
