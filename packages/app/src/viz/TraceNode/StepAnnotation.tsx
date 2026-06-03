import type { Move } from '@coach/pipeline';
import { segmentAccentOf } from '../layout/colors.ts';

interface Props {
  color: string;
  stepKind: 'inference' | 'action' | 'semantic' | undefined;
  verb: string | undefined;
  moves: readonly Move[] | undefined;
  actionVerbs: readonly string[] | undefined;
  segmentIndex: number | undefined;
}

function uniqueMoveVerbs(moves: readonly Move[] | undefined): string[] {
  if (moves == null) return [];
  return moves.map((m) => m.verb).filter((v, i, arr) => arr.indexOf(v) === i);
}

function annotationText(props: Props): string {
  if (props.stepKind === 'action') return props.verb ?? '';
  const moveVerbs = uniqueMoveVerbs(props.moves);
  const actions = props.actionVerbs ?? [];
  const parts = [moveVerbs.join(' · '), actions.length > 0 ? `→ ${actions.join(' · ')}` : '']
    .filter((p) => p !== '')
    .join('  ');
  return parts;
}

export function StepAnnotation(props: Props) {
  const { stepKind, segmentIndex, color } = props;
  if (stepKind == null) return null;
  const accent = segmentIndex != null ? segmentAccentOf(segmentIndex) : color;
  const text = annotationText(props);
  if (!text) return null;
  return (
    <div
      style={{
        borderTop: `1px solid ${accent}30`,
        borderLeft: `3px solid ${accent}`,
        background: `${accent}08`,
        padding: '3px 8px 3px 7px',
        fontSize: 10,
        color: accent,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {text}
    </div>
  );
}
