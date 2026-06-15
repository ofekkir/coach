import type { NodeProps } from '@xyflow/react';
import type { BandRFNode } from '../layout/types.ts';

// The faint band bracketing a parallel level — a backdrop behind the branch cards
// (pointer-events off so clicks reach them). The grouping reads from the band
// shape alone; no label.
export function BandView({ data }: NodeProps<BandRFNode>) {
  return (
    <div
      style={{
        width: data.width,
        height: data.height,
        pointerEvents: 'none',
        background: '#EAE3D6',
        opacity: 0.55,
        border: '1px dashed #DAD0BF',
        borderRadius: 13,
      }}
    />
  );
}
