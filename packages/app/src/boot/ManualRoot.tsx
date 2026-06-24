import type { VizResult } from '@coach/pipeline';
import { useState } from 'react';

import { UploadPage } from '../upload/UploadPage.tsx';
import { App } from '../viz/App/App.tsx';

// Manual-intake path: no `?data` boot param, so the user picks a pre-computed
// pipeline output file from the upload page; the chosen file renders in <App>.
// A `?focus` id, or a `?source`/`?dest`/`?highlight` set, flows through to App's
// one-shot boot focus / pair highlight.
export function ManualRoot({
  focusId,
  source,
  dest,
  highlight,
}: {
  focusId: string | null;
  source: string | null;
  dest: string | null;
  highlight: string | null;
}) {
  const [results, setResults] = useState<VizResult[] | null>(null);

  if (results == null) return <UploadPage onResults={setResults} />;

  const result = results[0];
  if (result == null) return null;

  return (
    <App
      data={result.data}
      title={result.title}
      initialFocusId={focusId ?? undefined}
      initialSource={source ?? undefined}
      initialDest={dest ?? undefined}
      initialHighlight={highlight ?? undefined}
    />
  );
}
