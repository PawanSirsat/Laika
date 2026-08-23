/**
 * Structured JSON logging to stdout (SPEC §13.2).
 *
 * A `console` wrapper on purpose — LAI-002's notes say not to add a logging
 * library yet, and nothing here needs transports, sampling or child loggers.
 * When something does, this is the single place that changes.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

/** Seam for tests: they assert on emitted records rather than on stdout. */
export type LogSink = (line: string) => void;

const defaultSink: LogSink = (line) => {
  process.stdout.write(`${line}\n`);
};

export function createLogger(sink: LogSink = defaultSink): Logger {
  const emit = (level: LogLevel, event: string, fields: LogFields = {}): void => {
    // `level` and `event` are written after the spread so a caller cannot
    // overwrite them with a stray field of the same name.
    sink(JSON.stringify({ ts: new Date().toISOString(), ...fields, level, event }));
  };

  return {
    debug: (event, fields) => {
      emit('debug', event, fields);
    },
    info: (event, fields) => {
      emit('info', event, fields);
    },
    warn: (event, fields) => {
      emit('warn', event, fields);
    },
    error: (event, fields) => {
      emit('error', event, fields);
    },
  };
}
