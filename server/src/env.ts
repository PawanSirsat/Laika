/**
 * Environment parsing, done once at boot so a bad value fails immediately with a
 * readable message instead of surfacing as a confusing runtime error later.
 *
 * SPEC §11.7 lists more variables than this (`DATA_DIR`, `SERVER_SECRET`,
 * `PUBLIC_URL`, `DISABLE_INVITE_ONLY`). They are deliberately absent: nothing in
 * LAI-002 reads them, and a variable parsed here but unused is a variable whose
 * validation nobody has tested. They arrive with the tasks that need them —
 * `DATA_DIR` with LAI-003, the rest with LAI-005 and later.
 */

export interface Env {
  readonly port: number;
  readonly host: string;
  readonly nodeEnv: 'development' | 'test' | 'production';
}

const DEFAULT_PORT = 3000;

/** Binding 0.0.0.0 is what makes the container reachable from outside it. */
const DEFAULT_HOST = '0.0.0.0';

export class EnvError extends Error {
  constructor(variable: string, value: string, expected: string) {
    super(`Invalid ${variable}: ${JSON.stringify(value)}. Expected ${expected}.`);
    this.name = 'EnvError';
  }
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;

  // Number() accepts '' , '0x10' and ' 12 '; none of those are a port anyone
  // meant to type, so match the shape first and convert second.
  if (!/^\d+$/.test(raw)) throw new EnvError('PORT', raw, 'an integer between 1 and 65535');

  const port = Number(raw);
  if (port < 1 || port > 65535) throw new EnvError('PORT', raw, 'an integer between 1 and 65535');

  return port;
}

function parseNodeEnv(raw: string | undefined): Env['nodeEnv'] {
  if (raw === undefined || raw === '') return 'production';
  if (raw === 'development' || raw === 'test' || raw === 'production') return raw;
  throw new EnvError('NODE_ENV', raw, "one of 'development', 'test', 'production'");
}

export function readEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return {
    port: parsePort(source['PORT']),
    host: source['HOST'] === undefined || source['HOST'] === '' ? DEFAULT_HOST : source['HOST'],
    nodeEnv: parseNodeEnv(source['NODE_ENV']),
  };
}
