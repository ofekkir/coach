// Why: the upload / landing surface keeps the cool slate palette (Tailwind slate +
// red) it shipped with — it has NOT been migrated to the warm graph system in
// `viz/theme.ts`. Centralized here so the raw hex lives in one place rather than
// scattered across the upload components.

export const slate = {
  page: '#f8fafc',
  surface: '#ffffff',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  divider: '#f1f5f9',
  faint: '#94a3b8',
  muted: '#64748b',
  label: '#475569',
  body: '#334155',
  heading: '#1e293b',
} as const;

export const danger = {
  text: '#dc2626',
  bg: '#fef2f2',
  border: '#fecaca',
} as const;
