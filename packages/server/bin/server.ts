#!/usr/bin/env -S node --experimental-strip-types
// Entry point: `coach-server` serves the app's /api/* routes over HTTP. Listens on
// $PORT (default 5179). Diagnostics go to stderr.

import { createServer } from '../src/index.ts';

const DEFAULT_PORT = 5179;
const port = Number(process.env.PORT ?? DEFAULT_PORT);

const { server } = createServer();
server.listen(port, () => {
  process.stderr.write(`coach-server listening on http://localhost:${String(port)}\n`);
});
