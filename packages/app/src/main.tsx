import type { VizResult } from '@coach/pipeline';
import { ReactFlowProvider } from '@xyflow/react';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { UploadPage } from './upload/UploadPage.tsx';
import { App } from './viz/App/App.tsx';

function Root() {
  const [results, setResults] = useState<VizResult[] | null>(null);

  if (results == null) {
    return <UploadPage onResults={setResults} />;
  }

  const result = results[0];
  if (result == null) return null;

  return <App data={result.data} title={result.title} />;
}

const root = document.getElementById('root');
if (root == null) throw new Error('No #root element');

createRoot(root).render(
  <StrictMode>
    <ReactFlowProvider>
      <Root />
    </ReactFlowProvider>
  </StrictMode>,
);
