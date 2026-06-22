import type { TableSpec } from '../spec.ts';

export const SEMANTICS: TableSpec = {
  name: 'semantics',
  doc: "Stage-6 semantic labels. Sparse — only relabeled (tool / llm_request) nodes get a row; the presence of a row IS the 'is this enriched?' flag. `what` values come from the closed ontology vocabulary (see describe_schema → vocabulary).",
  columns: [
    { name: 'id', sqlType: 'VARCHAR', doc: 'FK → nodes.id.' },
    {
      name: 'what',
      sqlType: 'JSON',
      doc: 'Ordered list of atomic action phrases, e.g. ["fetch ynet.co.il","summarize headlines"].',
    },
    {
      name: 'comment',
      sqlType: 'VARCHAR',
      doc: 'Optional agent-authored annotation harvested verbatim (e.g. a Bash `description`). Display signal only.',
    },
  ],
};
