// The upload / landing surface keeps the cool slate palette (Tailwind slate +
// red) it shipped with — it has NOT been migrated to the warm graph system in
// `viz/theme.ts`. Centralized here so the raw hex lives in one place rather than
// scattered across the upload components.

export const slate = {
  page: '#f8fafc', // page background, secondary button fill, dir-group fill
  surface: '#ffffff', // cards
  border: '#e2e8f0', // card borders, hairlines
  borderStrong: '#cbd5e1', // drop-zone idle border, button border
  divider: '#f1f5f9', // panel section dividers, neutral button fill
  faint: '#94a3b8', // muted captions, ghost-button text, processing fill
  muted: '#64748b', // secondary body text
  label: '#475569', // form labels
  body: '#334155', // body text, button labels
  heading: '#1e293b', // headings + primary button fill
} as const;

export const danger = {
  text: '#dc2626', // error message text
  bg: '#fef2f2', // error message fill
  border: '#fecaca', // error message border
} as const;
