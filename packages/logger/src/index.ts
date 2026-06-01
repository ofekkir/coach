import pino from 'pino';
import pinoPretty from 'pino-pretty';

export type Logger = pino.Logger;
export type LoggerOptions = pino.LoggerOptions;

const level = process.env.LOG_LEVEL ?? 'info';
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Output seam. A dev TTY gets human-readable pretty output; everything else gets
 * structured JSON on stdout (what a collector agent forwards). Both streams are
 * SYNCHRONOUS so CLI scripts that log then process.exit() don't drop records.
 *
 * THIS IS THE SEAM for choosing where logs go. To ship directly to OTEL / Coralogix /
 * Datadog later, swap this body for the matching pino transport (e.g.
 * pino.transport({ target: 'pino-opentelemetry-transport', ... })). Call sites never change.
 */
function defaultStream(): pino.DestinationStream {
  const usePretty = !isProduction && process.stdout.isTTY;
  return usePretty ? pinoPretty({ colorize: true, sync: true }) : pino.destination({ sync: true });
}

export function createLogger(options: LoggerOptions = {}): Logger {
  return pino({ level, ...options }, defaultStream());
}

/** Shared logger. Import everywhere instead of console; add context via log.child({...}). */
export const log: Logger = createLogger();
