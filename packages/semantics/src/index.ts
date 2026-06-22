// Why: pure (no node:*) — JSON artifacts are bundled and imported, never read
// from disk, so the same assembled config serves both the Node CLI and the
// browser app.

export { defaultSemanticsConfig } from './defaults.ts';
export { coarseAction, shellCommandAction } from './action.ts';
export { INTENT_CATEGORIES, classifyIntent, type IntentCategory } from './intent.ts';
export { assembleSemanticsConfig, actionLabel, objectLabel, strField, isRecord } from './config.ts';
export type {
  AgentSemantics,
  MatchClause,
  MessageAct,
  Ontology,
  OntologyAction,
  SemanticsConfig,
  ToolModifier,
  ToolOverride,
  ToolSemantics,
} from './config.ts';
