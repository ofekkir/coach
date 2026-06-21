import { ReactFlowProvider } from '@xyflow/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './viz/App/App.tsx';
import { ErrorScreen } from './boot/ErrorScreen.tsx';
import { ManualRoot } from './boot/ManualRoot.tsx';
import { loadPipelineOutput } from './data-source.ts';
import type { VizResult } from '@coach/pipeline';

interface BootParams {
  dataUrl: string | null;
  focusId: string | null;
}

function readBootParams(): BootParams {
  const params = new URLSearchParams(window.location.search);
  return { dataUrl: params.get('data'), focusId: params.get('focus') };
}

// Derives a human title from the data url — its filename without the extension,
// falling back to a generic label when the url has no usable path segment.
function titleFromUrl(url: string): string {
  try {
    const { pathname } = new URL(url, window.location.href);
    const file = pathname.split('/').pop() ?? '';
    const name = decodeURIComponent(file).replace(/\.json$/i, '');
    return name === '' ? 'pipeline output' : name;
  } catch {
    return 'pipeline output';
  }
}

async function fetchPipelineOutput(url: string): Promise<VizResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not fetch data (HTTP ${String(response.status)}): ${url}`);
  }
  const text = await response.text();
  return loadPipelineOutput(text, titleFromUrl(url));
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
  const { dataUrl, focusId } = readBootParams();

  if (dataUrl == null) {
    renderApp(<ManualRoot focusId={focusId} />);
    return;
  }

  try {
    const result = await fetchPipelineOutput(dataUrl);
    renderApp(
      <App data={result.data} title={result.title} initialFocusId={focusId ?? undefined} />,
    );
  } catch (err) {
    renderApp(<ErrorScreen message={err instanceof Error ? err.message : 'Unknown error.'} />);
  }
}

void boot();
