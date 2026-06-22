import type { TableSpec } from '../spec.ts';

export const CONTAINMENT: TableSpec = {
  name: 'containment',
  doc: 'The containment relation ("parent contains child in time"), derived from the node `parent` self-FK. Exactly one parent per child. Walk it with the `subtree` tool or a recursive CTE.',
  columns: [
    { name: 'parent_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (the container).' },
    { name: 'child_id', sqlType: 'VARCHAR', doc: 'FK → nodes.id (contained).' },
  ],
};
