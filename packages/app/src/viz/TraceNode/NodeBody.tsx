import { ellipsis, fonts, tokens } from '../theme.ts';

export interface StepPalette {
  title: string;
  sub: string;
  model: string;
}

const SHARE_PCT_BASE = 100;

function sharePct(shareOfRun: number): number {
  return Math.round(shareOfRun * SHARE_PCT_BASE);
}

function shareBar(shareOfRun: number): React.ReactNode {
  return (
    <>
      <div
        style={{
          marginTop: 9,
          height: 4,
          borderRadius: 2,
          background: tokens.shareTrack,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${String(sharePct(shareOfRun))}%`,
            height: '100%',
            background: tokens.accent,
            borderRadius: 2,
          }}
        />
      </div>
      <div
        style={{ fontFamily: fonts.mono, fontSize: 9.5, color: tokens.accentInkSoft, marginTop: 5 }}
      >
        {String(sharePct(shareOfRun))}% of interaction · longest step
      </div>
    </>
  );
}

export function NodeBody({
  title,
  subtitle,
  model,
  shareOfRun,
  palette,
}: {
  title: string | undefined;
  subtitle: string | undefined;
  model: string | undefined;
  shareOfRun: number | undefined;
  palette: StepPalette;
}) {
  return (
    <>
      {title != null && (
        <div
          style={{
            ...ellipsis,
            fontFamily: fonts.sans,
            fontSize: 14.5,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: palette.title,
          }}
        >
          {title}
        </div>
      )}
      {subtitle != null && (
        <div
          style={{
            ...ellipsis,
            fontFamily: fonts.sans,
            fontSize: 13,
            color: palette.sub,
            marginTop: 1,
          }}
        >
          {subtitle}
        </div>
      )}
      {shareOfRun != null && shareBar(shareOfRun)}
      {model != null && (
        <div
          style={{
            ...ellipsis,
            fontFamily: fonts.mono,
            fontSize: 10.5,
            color: palette.model,
            marginTop: 7,
          }}
        >
          {model}
        </div>
      )}
    </>
  );
}
