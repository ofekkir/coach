import type { VizResult } from '@coach/pipeline';
import { useState } from 'react';

import { UploadPage } from '../upload/UploadPage.tsx';
import { App } from '../viz/App/App.tsx';

// Why: this path runs only when there is no `?data` boot param, so intake is
// manual — the user picks a pre-computed pipeline output from the upload page,
// and any `?focus` id flows through to App's one-shot boot focus.
export function ManualRoot({ focusId }: { focusId: string | null }) {
  const [results, setResults] = useState<VizResult[] | null>(null);

  if (results == null) return <UploadPage onResults={setResults} />;

  const result = results[0];
  if (result == null) return null;

  return <App data={result.data} title={result.title} initialFocusId={focusId ?? undefined} />;
}
