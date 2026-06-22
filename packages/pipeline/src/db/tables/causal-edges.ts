import type { TableSpec } from '../spec.ts';

export const CAUSAL_EDGES: TableSpec = {
  name: 'causal_edges',
  doc: 'The causal DAG ("cause triggers effect") — the only edge layer with causal meaning (time-adjacency is NOT causality). Inference→tool fan-out, tool→inference fan-in (by tool_use_id), inference→inference continuation, prompt→turn. Walk it with the `causal_path` tool.',
  columns: [
    { name: 'from_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (the cause).' },
    { name: 'to_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (the effect).' },
    {
      name: 'gap_ms',
      sqlType: 'DOUBLE',
      doc: 'Signed gap cause-end → effect-start (often negative for fan-out dispatched mid-stream).',
    },
  ],
};
