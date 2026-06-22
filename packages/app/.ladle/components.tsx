import type { GlobalProvider } from '@ladle/react';
import { ReactFlowProvider } from '@xyflow/react';

import { fonts, tokens } from '../src/viz/theme.ts';

const CANVAS_PAD = 24;

// Every story renders inside the app's React Flow context — graph-node stories
// (TraceNode, BandNode) need it — on the warm paper canvas and sans family so
// glyphs and cards read exactly as they do in the live graph.
export const Provider: GlobalProvider = ({ children }) => (
  <ReactFlowProvider>
    <div
      style={{
        fontFamily: fonts.sans,
        background: tokens.paper,
        minHeight: '100vh',
        padding: CANVAS_PAD,
      }}
    >
      {children}
    </div>
  </ReactFlowProvider>
);
