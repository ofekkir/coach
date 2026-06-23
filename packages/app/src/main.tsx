import type { VizResult } from '@coach/pipeline';
import { ReactFlowProvider } from '@xyflow/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { ErrorScreen } from './boot/ErrorScreen.tsx';
import { ManualRoot } from './boot/ManualRoot.tsx';
import { loadPipelineOutput } from './data-source.ts';
import { App } from './viz/App/App.tsx';

interface BootParams {
  dataUrl: string | null;
  focusId: string | null;
  source: string | null;
  dest: string | null;
  highlight: string | null;
}

function readBootParams(): BootParams {
  const params = new URLSearchParams(window.location.search);
  return {
    dataUrl: params.get('data'),
    focusId: params.get('focus'),
    source: params.get('source'),
    dest: params.get('dest'),
    highlight: params.get('highlight'),
  };
}

async function fetchPipelineOutput(url: string): Promise<VizResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch data (HTTP ${String(response.status)}): ${url}`);
  }
  const text = await response.text();
  return loadPipelineOutput(text, 'coach');
}

function renderApp(node: React.ReactNode): void {
  const root = document.getElementById('root');
  if (root == null) throw new Error('No #root element');
  createRoot(root).render(
    <StrictMode>
      <ReactFlowProvider>{node}</ReactFlowProvider>
    </StrictMode>,
  );
}

async function boot(): Promise<void> {
  const { dataUrl, focusId, source, dest, highlight } = readBootParams();

  if (dataUrl == null) {
    renderApp(<ManualRoot focusId={focusId} source={source} dest={dest} highlight={highlight} />);
    return;
  }

  try {
    const result = await fetchPipelineOutput(dataUrl);
    renderApp(
      <App
        data={result.data}
        title={result.title}
        initialFocusId={focusId ?? undefined}
        initialSource={source ?? undefined}
        initialDest={dest ?? undefined}
        initialHighlight={highlight ?? undefined}
      />,
    );
  } catch (err) {
    renderApp(<ErrorScreen message={err instanceof Error ? err.message : 'Unknown error.'} />);
  }
}

void boot();
