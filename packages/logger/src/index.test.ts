import { describe, it, expect } from 'vitest';
import { pino } from 'pino';
import { log, createLogger } from './index.ts';

describe('logger exports', () => {
  it('exports log and createLogger with expected methods', () => {
    expect(typeof log.info).toBe('function');
    expect(typeof log.error).toBe('function');
    expect(typeof log.child).toBe('function');
    expect(typeof createLogger).toBe('function');
  });

  it('serialises fields and message', () => {
    const lines: string[] = [];
    const logger = pino({ level: 'info' }, { write: (l) => lines.push(l) });
    logger.info({ nodes: 3 }, 'wrote');
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed.msg).toBe('wrote');
    expect(parsed.nodes).toBe(3);
  });

  it('child logger inherits context', () => {
    const lines: string[] = [];
    const logger = pino({ level: 'info' }, { write: (l) => lines.push(l) });
    logger.child({ runId: 'abc' }).info('x');
    const parsed = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(parsed.runId).toBe('abc');
  });
});
