// The single source of truth for where a directory `load_dataset` materializes
// its stage-output artifacts (the `01..06` stage JSON files + `graph.db`). Both
// the dump target (session.ts) and the viz read default (viz-server.ts) resolve
// through here so they never drift — dump-here and read-there must point at the
// same place. It is the repo-already-gitignored `out/` under the cwd, keeping
// artifacts out of whatever directory the server happens to run from.

import { join } from 'node:path';

const OUTPUT_DIR_NAME = 'out';

/** The directory under the cwd where pipeline dump artifacts are written and
 *  read back from. Shared by the dump target and the viz read default. */
export function outputDir(): string {
  return join(process.cwd(), OUTPUT_DIR_NAME);
}
