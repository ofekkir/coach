// @coach/server — the app's HTTP backend. Wraps the pipeline + the @coach/store
// query surface (via @coach/mcp's read-only DuckDB) behind /api/* routes the React
// app talks to through its data-source seam. A Service Worker can later answer the
// same routes locally to restore in-browser execution (see docs/ plan).

export { createServer } from './server.ts';
export type { CoachServer } from './server.ts';
