import { defineConfig } from 'tsup';

// Bundles @coach/mcp into a self-contained, publishable dist. The TypeScript workspace
// deps (@coach/pipeline, @coach/semantics — including their bundled JSON data) are
// inlined so the published package has no unresolved `workspace:*` references. The
// native/runtime deps stay external real npm deps: @duckdb/node-api ships a prebuilt
// native module that must not be bundled, and @modelcontextprotocol/sdk + zod resolve
// from node_modules at runtime.
//
// The bin source (`bin/mcp.ts`) carries a `#!/usr/bin/env node` shebang that tsup
// preserves into `dist/bin/mcp.js`; the built JS runs with no extra Node flags.
export default defineConfig({
  entry: { 'bin/mcp': 'bin/mcp.ts' },
  format: 'esm',
  target: 'node20',
  platform: 'node',
  bundle: true,
  splitting: false,
  clean: true,
  dts: false,
  sourcemap: true,
  loader: { '.json': 'json' },
  external: ['@duckdb/node-api', '@modelcontextprotocol/sdk', 'zod'],
  noExternal: ['@coach/pipeline', '@coach/semantics'],
});
