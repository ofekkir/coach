const TYPE_COLORS: Record<string, string> = {
  agent: '#44AA99',
  session: '#332288',
  interaction: '#5599BB',
  user_prompt: '#AA7733',
  llm_request: '#882255',
  tool: '#CC6677',
  blocked_on_user: '#B8A840',
  execution: '#999933',
  hook: '#117733',
};

const TYPE_FILLS: Record<string, string> = {
  agent: '#EAF6F4',
  session: '#EAEBF5',
  interaction: '#EDF5FB',
  user_prompt: '#F6F1E9',
  llm_request: '#F2E9ED',
  tool: '#F9EDEF',
  blocked_on_user: '#FBF9EC',
  execution: '#F4F4E9',
  hook: '#E5F0E9',
};

export function colorOf(type: string): string {
  return TYPE_COLORS[type] ?? '#94a3b8';
}

export function fillOf(type: string): string {
  return TYPE_FILLS[type] ?? '#f8fafc';
}

const SEGMENT_ACCENT_COLORS = ['#5599BB', '#44AA99', '#CC6677', '#882255', '#117733'];

export function segmentAccentOf(index: number): string {
  return SEGMENT_ACCENT_COLORS[index % SEGMENT_ACCENT_COLORS.length] ?? '#94a3b8';
}
