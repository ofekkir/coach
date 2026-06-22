import type { TableSpec } from '../spec.ts';

export const THREADS: TableSpec = {
  name: 'threads',
  doc: 'Layout lanes — a grouping of an interaction\'s steps into an execution lane (e.g. "repl_main_thread"). Membership only; adjacency here is NOT causality.',
  columns: [
    { name: 'thread_id', sqlType: 'VARCHAR', doc: 'Thread id.' },
    { name: 'interaction_id', sqlType: 'VARCHAR', doc: 'FK → owning interaction node id.' },
    { name: 'source', sqlType: 'VARCHAR', doc: "The loop that emitted the lane's inferences." },
    { name: 'node_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (a top-level member of the lane).' },
    {
      name: 'position',
      sqlType: 'INTEGER',
      doc: '0-based order of the member within the lane (time order).',
    },
  ],
};
