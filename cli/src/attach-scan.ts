import { basename } from 'node:path';
import { Budget, DEFAULT_LIMITS, isZip, type OfficeLimits, zipContents } from './office-text.ts';
import { scanForSecrets, type SecretPatternName } from './secret-scan.ts';

/**
 * Whether a file may leave this machine, decided **by what is in it**
 * (D-162 item 4, LAI-1351).
 *
 * The board scans a text file again when its upload completes; this runs
 * first, here, before a byte is sent, and reads more: **any file with no NUL
 * byte is text** and
 * is scanned whatever it is called, and an `.xlsx`, `.docx` or `.pptx` is
 * opened and its cells, paragraphs and slides are scanned. **Any other zip is
 * opened too, and every file in it checked as this checks a file** — a zip
 * inside it, or a workbook embedded in a document, in turn — up to
 * {@link MAX_DEPTH} deep and within one budget for the whole upload
 * (LAI-1361). A file named as a key — `*.pem`,
 * `*.key`, `id_rsa` and the other `id_*` — is scanned like any text, so a
 * certificate passes and a private key does not; **in binary form it is
 * refused by its name**, because a binary key has no text to recognise. A
 * keystore — `*.p12`, `*.pfx`, `*.jks` — always holds a private key, and is
 * refused by its name alone.
 *
 * The verdict names the rule and where — a line, a sheet's row — and never
 * the text that matched. There is no override: the answer is a masked copy.
 */

export type ScanVerdict =
  | { readonly ok: true; readonly scanned: 'text' | 'office' | 'archive' | 'binary' }
  | {
      readonly ok: false;
      /**
       * A rule from `SECRET_PATTERNS`; `unreadable` for a zip this could not
       * open; `too_large` for one holding more than it reads (LAI-1361 review).
       */
      readonly pattern: SecretPatternName | 'unreadable' | 'too_large';
      /**
       * Where, in words: `line 3`, `sheet 1, row 4`, `its name` — and inside
       * a zip, the path first: `config/.env, line 2`, `inner.zip › .env, line 2`.
       */
      readonly where: string;
    };

/** Names that are a key file. `.pub` is a public key, and is not one. */
const KEY_NAME = /(?:\.(?:pem|key)|^id_[a-z0-9_-]+)$/i;

/** Names that are a keystore, which always holds a private key. */
const KEYSTORE_NAME = /\.(?:p12|pfx|jks|keystore)$/i;

export function isKeyName(filename: string): boolean {
  const name = basename(filename);
  return KEY_NAME.test(name) && !name.toLowerCase().endsWith('.pub');
}

/** How many zips deep a file is looked inside; one deeper cannot be checked. */
export const MAX_DEPTH = 4;

const UNREADABLE: ScanVerdict = { ok: false, pattern: 'unreadable', where: 'its contents' };
const TOO_LARGE: ScanVerdict = { ok: false, pattern: 'too_large', where: 'its size' };
const BY_NAME: ScanVerdict = { ok: false, pattern: 'private_key', where: 'its name' };

/**
 * Whether `bytes`, called `filename`, may be uploaded. `limits` is the most
 * inflated from one part and from the whole file, and the most files looked
 * at in it, every zip inside it included; a test passes smaller ones.
 */
export function scanFile(
  filename: string,
  bytes: Uint8Array,
  limits: OfficeLimits = DEFAULT_LIMITS,
): ScanVerdict {
  return scanOne(filename, bytes, new Budget(limits.total, limits.files), limits.part, 0);
}

function scanOne(
  filename: string,
  bytes: Uint8Array,
  budget: Budget,
  part: number,
  depth: number,
): ScanVerdict {
  if (KEYSTORE_NAME.test(basename(filename))) return BY_NAME;
  if (isZip(bytes)) return scanZip(bytes, budget, part, depth);

  if (bytes.includes(0)) return isKeyName(filename) ? BY_NAME : { ok: true, scanned: 'binary' };
  const hit = scanForSecrets(new TextDecoder().decode(bytes));
  return hit === null
    ? { ok: true, scanned: 'text' }
    : { ok: false, pattern: hit.pattern, where: `line ${String(hit.line)}` };
}

/** An office file's text, then every file inside it, each as `scanOne` checks a file. */
function scanZip(bytes: Uint8Array, budget: Budget, part: number, depth: number): ScanVerdict {
  if (depth >= MAX_DEPTH) return UNREADABLE;
  const contents = zipContents(bytes, budget, part);
  if ('refused' in contents) return contents.refused === 'too_large' ? TOO_LARGE : UNREADABLE;
  for (const text of contents.parts) {
    const hit = scanForSecrets(text.text);
    if (hit === null) continue;
    const row = text.rows[hit.line - 1];
    const at = text.where.startsWith('sheet')
      ? `${text.where}, row ${String(row ?? hit.line)}`
      : `${text.where}, line ${String(hit.line)}`;
    return { ok: false, pattern: hit.pattern, where: at };
  }
  for (const file of contents.files) {
    const verdict = scanOne(file.path, file.bytes, budget, part, depth + 1);
    if (verdict.ok) continue;
    // `inner.zip › .env, line 2`: a zip's path leads into it, a file's is followed by where in it.
    const join = isZip(file.bytes) && verdict.where !== 'its name' ? ' › ' : ', ';
    return { ...verdict, where: `${file.path}${join}${verdict.where}` };
  }
  return { ok: true, scanned: contents.office ? 'office' : 'archive' };
}

/** What each rule is, in words, for the refusal: never the value it matched. */
export const SECRET_WORDS: Readonly<
  Record<SecretPatternName | 'unreadable' | 'too_large', string>
> = {
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
  unreadable: 'a zip or an office file that could not be opened to check it',
  too_large: 'a zip or an office file too large to check',
};
