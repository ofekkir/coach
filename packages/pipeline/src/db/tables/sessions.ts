import type { TableSpec } from '../spec.ts';

export const SESSIONS: TableSpec = {
  name: 'sessions',
  doc: 'The session dimension entity — a FK target referenced by nodes.session_id, never a node.',
  columns: [
    {
      name: 'id',
      sqlType: 'VARCHAR',
      doc: 'Session entity id (the value carried as nodes.session_id).',
    },
    { name: 'agent_id', sqlType: 'VARCHAR', doc: 'FK → agents.id.' },
    { name: 'user_id', sqlType: 'VARCHAR', doc: 'The user behind the session.' },
    { name: 'session_id', sqlType: 'VARCHAR', doc: "The harness's own session id." },
    { name: 'title', sqlType: 'VARCHAR', doc: 'Optional session title.' },
    // prettier-ignore
    { name: 'cwd', sqlType: 'VARCHAR', doc: 'Absolute working directory the session ran in. Populated for native Claude sessions; NULL for OTEL traces (no cwd attribute).' },
    // prettier-ignore
    { name: 'branch', sqlType: 'VARCHAR', doc: 'Git branch the session ran on. Populated for native Claude sessions; NULL for OTEL traces (no branch attribute).' },
  ],
};
