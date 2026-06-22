// The relational-spec vocabulary shared by every table and view file. A spec is
// pure data — column names, DuckDB types, and docs — consumed by two readers that
// must never disagree: `materialize.ts` (emits the DDL/DML the data lives in) and
// the MCP `describe_schema` tool (the schema the analyst agent reads).

export interface ColumnSpec {
  readonly name: string;
  /** DuckDB column type. `JSON` columns are populated from a JS value via CAST. */
  readonly sqlType: 'VARCHAR' | 'DOUBLE' | 'INTEGER' | 'BIGINT' | 'BOOLEAN' | 'JSON';
  readonly doc: string;
}

export interface TableSpec {
  readonly name: string;
  readonly doc: string;
  readonly columns: readonly ColumnSpec[];
  /** When set, this relation is a DuckDB VIEW with this SELECT body (computed on
   *  read against `nodes`), not a materialized table — no rows are ever inserted. */
  readonly view?: string;
}

// Projects a subset of a source table's column specs by name, preserving the given
// order. Per-type views call this against `NODES.columns` so their documented
// columns ARE the `nodes` columns — a view can never describe a column differently
// from the table it projects, and a column rename/retype propagates automatically.
// Throws at module load if a name is misspelled or no longer exists.
export function pickColumns(source: readonly ColumnSpec[], names: readonly string[]): ColumnSpec[] {
  return names.map((name) => {
    const column = source.find((c) => c.name === name);
    if (column == null) throw new Error(`pickColumns: no column named '${name}' in source table`);
    return column;
  });
}
