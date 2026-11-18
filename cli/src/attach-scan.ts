import { basename } from 'node:path';
import { isZip, officeText } from './office-text.ts';
import { scanForSecrets, type SecretPatternName } from './secret-scan.ts';

/**
 * Whether a file may leave this machine, decided **by what is in it**
 * (D-162 item 4, LAI-1351).
 *
 * The board scans a completed upload by its declared type and name; this
 * runs first, here, and reads more: **any file with no NUL byte is text** and
 * is scanned whatever it is called, an `.xlsx` or `.docx` is opened and its
 * cells and paragraphs are scanned, and a file named as a key — `*.pem`,
 * `*.key`, `id_rsa` and the other `id_*` — is refused by its name alone,
 * because a key in binary form has no text to recognise.
 *
 * The verdict names the rule and where — a line, a sheet's row — and never
 * the text that matched. There is no override: the answer is a masked copy.
 */

export type ScanVerdict =
  | { readonly ok: true; readonly scanned: 'text' | 'office' | 'binary' }
  | {
      readonly ok: false;
      /** A rule from `SECRET_PATTERNS`, or `unreadable` for an office file this could not open. */
      readonly pattern: SecretPatternName | 'unreadable';
      /** Where, in words: `line 3`, `sheet 1, row 4`, `its name`. */
      readonly where: string;
    };

/** Names that are a key whatever they hold. `.pub` is a public key, and passes. */
const KEY_NAME = /(?:\.(?:pem|key|p12|pfx)|^id_[a-z0-9_-]+)$/i;

export function isKeyName(filename: string): boolean {
  const name = basename(filename);
  return KEY_NAME.test(name) && !name.toLowerCase().endsWith('.pub');
}

export function scanFile(filename: string, bytes: Uint8Array): ScanVerdict {
  if (isKeyName(filename)) return { ok: false, pattern: 'private_key', where: 'its name' };

  if (isZip(bytes)) {
    const parts = officeText(bytes);
    if (parts === undefined) return { ok: false, pattern: 'unreadable', where: 'its contents' };
    if (parts !== null) {
      for (const part of parts) {
        const hit = scanForSecrets(part.text);
        if (hit === null) continue;
        const row = part.rows[hit.line - 1];
        const at = part.where.startsWith('sheet')
          ? `${part.where}, row ${String(row ?? hit.line)}`
          : `${part.where}, line ${String(hit.line)}`;
        return { ok: false, pattern: hit.pattern, where: at };
      }
      return { ok: true, scanned: 'office' };
    }
  }

  if (bytes.includes(0)) return { ok: true, scanned: 'binary' };
  const hit = scanForSecrets(new TextDecoder().decode(bytes));
  return hit === null
    ? { ok: true, scanned: 'text' }
    : { ok: false, pattern: hit.pattern, where: `line ${String(hit.line)}` };
}

/** What each rule is, in words, for the refusal: never the value it matched. */
export const SECRET_WORDS: Readonly<Record<SecretPatternName | 'unreadable', string>> = {
  private_key: 'a private key',
  aws_access_key_id: 'an AWS access key id',
  aws_secret_access_key: 'an AWS secret access key',
  laika_token: 'a Laika token',
  github_token: 'a GitHub token',
  sk_token: 'an API key (sk-…)',
  password_value: 'a password',
  env_secret: 'a secret in an environment line',
  url_credentials: 'a password in a URL',
  credential_column: 'a credentials column with values in it',
  unreadable: 'an office file that could not be opened to check it',
};
