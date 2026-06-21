import { useState } from 'react';
import type { VizResult } from '@coach/pipeline';
import { App } from '../viz/App/App.tsx';
import { UploadPage } from '../upload/UploadPage.tsx';

// Manual-intake path: no `?data` boot param, so the user picks a pre-computed
// pipeline output file from the upload page; the chosen file renders in <App>.
// A `?focus` id (if any) flows through to App's one-shot boot focus.
export function ManualRoot({ focusId }: { focusId: string | null }) {
  const [results, setResults] = useState<VizResult[] | null>(null);

  if (results == null) return <UploadPage onResults={setResults} />;

  const result = results[0];
  if (result == null) return null;

  return <App data={result.data} title={result.title} initialFocusId={focusId ?? undefined} />;
}
