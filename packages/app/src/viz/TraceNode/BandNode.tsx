import type { NodeProps } from '@xyflow/react';

import type { BandRFNode } from '../layout/types.ts';
import { tokens } from '../theme.ts';

// Why: pointer-events are off so clicks pass through the band to the branch
// cards beneath it; the grouping reads from the band shape alone, so no label.
export function BandView({ data }: NodeProps<BandRFNode>) {
  return (
    <div
      style={{
        width: data.width,
        height: data.height,
        pointerEvents: 'none',
        background: tokens.bandFill,
        opacity: 0.55,
        border: `1px dashed ${tokens.bandBorder}`,
        borderRadius: 13,
      }}
    />
  );
}
