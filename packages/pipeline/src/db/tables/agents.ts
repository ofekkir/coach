import type { TableSpec } from '../spec.ts';

export const AGENTS: TableSpec = {
  name: 'agents',
  doc: 'The agent dimension entity — a FK target, never a node. Single-agent today.',
  columns: [
    { name: 'id', sqlType: 'VARCHAR', doc: 'Agent id.' },
    { name: 'user_id', sqlType: 'VARCHAR', doc: 'The user behind the agent.' },
  ],
};
