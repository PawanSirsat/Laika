import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SERVER_ROOT } from './paths.ts';

/**
 * The version `GET /api/v1/health` reports.
 *
 * Read from `package.json` at runtime rather than imported. A JSON import would
 * need `with { type: 'json' }` and pin us to how each of tsx, tsc and Vite
 * happens to treat import attributes; a file read behaves the same everywhere.
 */
export function readVersion(root: string = SERVER_ROOT): string {
  const raw: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  if (typeof raw !== 'object' || raw === null || !('version' in raw)) {
    throw new Error(`No "version" field in ${join(root, 'package.json')}`);
  }

  const { version } = raw;
  if (typeof version !== 'string' || version === '') {
    throw new Error(`Invalid "version" in ${join(root, 'package.json')}`);
  }

  return version;
}
