import type { TableSpec } from '../spec.ts';

export const DELTAS: TableSpec = {
  name: 'deltas',
  doc: 'Stage-5 message deltas. Sparse — only llm_request nodes get a row. The messages new to this request relative to the previous request in its thread.',
  columns: [
    { name: 'id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (an llm_request).' },
    {
      name: 'request_messages_delta',
      sqlType: 'JSON',
      doc: 'Request messages beyond the previous request (the first carries its full array).',
    },
    {
      name: 'response_messages_delta',
      sqlType: 'JSON',
      doc: 'The full response (each response is all-new).',
    },
  ],
};
