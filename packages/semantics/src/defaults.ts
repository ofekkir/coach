import { assembleSemanticsConfig, type SemanticsConfig } from './config.ts';
import codingOntology from './data/ontology/coding.json' with { type: 'json' };
import claudeCodeAgent from './data/agents/claude-code.json' with { type: 'json' };

// The default semantics pair — coding domain × claude-code agent — assembled from
// the bundled JSON artifacts. Importing (not disk-reading) the JSON keeps this
// module pure and browser-safe: the bundler inlines the data, so the pipeline
// orchestrator and the app share one assembled config with no file-system seam.
// Assembly runs at module load; a malformed artifact throws here (Zod or
// referential-integrity), so a broken config fails fast at import rather than mid-run.
export const defaultSemanticsConfig: SemanticsConfig = assembleSemanticsConfig(
  codingOntology,
  claudeCodeAgent,
);
