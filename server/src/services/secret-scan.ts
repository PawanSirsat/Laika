/**
 * The secret check an attachment passes before it is `ready` (§13.4, D-162
 * item 4, LAI-1302).
 *
 * D-162 lets an agent attach what it chooses to show a person, and says
 * **secrets are never uploaded**: the agent attaches a masked copy, and both
 * the CLI (before the upload, LAI-1351) and the server (on completion, here)
 * refuse a file that holds a secret they can recognise. There is no override.
 *
 * **One list, kept here, and mirrored by the CLI.** `SECRET_PATTERNS` names
 * every rule; `test/services/secret-scan.test.ts` probes each with one
 * sample it must catch and holds a clean CSV — and a masked one — that must
 * pass. A rule added here and not there fails that test.
 *
 * **Known patterns only.** The scan reads text — the types below, the first
 * `SECRET_SCAN_BYTES` of each — and recognises shapes: a private key block, a
 * cloud or a forge token, a `password: …` or a `.env` line, a column called
 * *password* with a value under it. The instruction to mask is the real
 * guard; this catches the copy that slipped through.
 *
 * **What it says is the rule and the line, never the text.** A hit names its
 * pattern and its 1-based line, so the agent can find and mask it; the value
 * it matched never leaves this function.
 */

/** How much of a text file is read and scanned: its first 2 MiB. */
export const SECRET_SCAN_BYTES = 2 * 1024 * 1024;

/** Media types read as text, besides every `text/*`. */
const TEXT_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/x-ndjson',
  'application/xml',
  'application/xhtml+xml',
  'application/yaml',
  'application/x-yaml',
  'application/toml',
  'application/csv',
  'application/sql',
  'application/x-sh',
  'application/x-env',
]);

/** Extensions read as text whatever type they were declared as. */
const TEXT_EXTENSIONS = new Set([
  'csv',
  'tsv',
  'txt',
  'text',
  'json',
  'ndjson',
  'md',
  'markdown',
  'log',
  'html',
  'htm',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'cfg',
  'properties',
  'env',
  'sql',
  'sh',
  // Keys and certificates, which are text: `server.pem`, `server.key`.
  'pem',
  'key',
  'crt',
  'cer',
  'asc',
  'ppk',
]);

/** Whole names that hold credentials, whatever they were declared as. */
const SECRET_NAMES = new Set([
  'credentials',
  '.npmrc',
  '.netrc',
  '.pgpass',
  '.git-credentials',
  '.htpasswd',
  '.dockercfg',
  '.pypirc',
]);

/**
 * Whether a file's name or declared type says it is text, so it is read for
 * the scan at once: a text type; `.env` and `prod.env`; a key — `id_rsa`,
 * `server.pem`, `server.key`; a credentials file — `credentials`, `.npmrc`.
 * The server also scans any other file whose first bytes are text
 * (`completeAttachment`), so this list decides only how soon it is read.
 */
export function isScannedFile(contentType: string, filename: string): boolean {
  const type = contentType.toLowerCase();
  if (type.startsWith('text/') || TEXT_TYPES.has(type)) return true;
  const name = filename.toLowerCase();
  if (name === '.env' || name.startsWith('.env.')) return true;
  if (SECRET_NAMES.has(name) || /^id_[a-z0-9]+$/.test(name)) return true;
  const dot = name.lastIndexOf('.');
  return dot >= 0 && TEXT_EXTENSIONS.has(name.slice(dot + 1));
}

/** Every rule, by the name a refusal carries in `details.pattern`. */
export const SECRET_PATTERNS = [
  'private_key',
  'aws_access_key_id',
  'aws_secret_access_key',
  'laika_token',
  'github_token',
  'sk_token',
  'password_value',
  'env_secret',
  'url_credentials',
  'credential_column',
] as const;

export type SecretPatternName = (typeof SECRET_PATTERNS)[number];

/** Which rule matched, and on which line (from 1). Never what it matched. */
export interface SecretHit {
  pattern: SecretPatternName;
  line: number;
}

/**
 * A value that is a placeholder or already masked — `********`, `xxxx`,
 * `<password>`, `${DB_PASSWORD}`, `[redacted]`, `ab**yz` — or one a script
 * works out when it runs, `$(pwd)`, and so not a secret. A masked copy is
 * what D-162 asks an agent to attach, so it must pass.
 */
function isMasked(value: string): boolean {
  const v = value.trim().replace(/^["'`]|["'`]$/g, '');
  if (v === '') return true;
  if (/^[*•xX#.\-_?]+$/.test(v)) return true;
  // Two stars or bullets in a row, at most four characters shown on either
  // side, stand for what was taken out: `p****d`, `ab**yz` — never
  // `Pa**w0rd!x`, a password that happens to hold two stars.
  if (/^[^*•]{0,4}(?:\*{2,256}|•{2,256})[^*•]{0,4}$/.test(v)) return true;
  if (/^<[^>]*>$/.test(v) || /^\$\{[^}]*\}$/.test(v) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(v)) {
    return true;
  }
  // A shell command's output — `pwd=$(pwd)`, `PASSWORD=$(vault read …)`:
  // the script asks for it at run time, and nothing is written down.
  if (v.startsWith('$(')) return true;
  if (/^\{\{[^}]*\}\}$/.test(v)) return true;
  return /^[[(]?(redacted|masked|hidden|removed|omitted|none|null|true|false|changeme|example)[\])]?$/i.test(
    v,
  );
}

/** A cell under a credential column that is a result or a note, never a credential. */
const NOT_A_SECRET = new Set([
  'ok',
  'yes',
  'no',
  'y',
  'n',
  'true',
  'false',
  'n/a',
  'na',
  'none',
  'null',
  'pass',
  'passed',
  'fail',
  'failed',
  'skip',
  'skipped',
  'done',
  'todo',
  '✓',
  '✔',
  '✗',
  '✘',
]);

/**
 * Words that say what a password field is or how it went, rather than being
 * one: a schema's `password: required`, a type's `password: string`, a log's
 * `password: accepted` or `password: unchanged`. The short ones — `set`,
 * `same` — are passed by length already, and listed so the list does not
 * lean on it.
 */
const DESCRIBES_A_PASSWORD = new Set([
  'set',
  'reset',
  'same',
  'none',
  'unchanged',
  'configured',
  'correct',
  'strong',
  'present',
  'required',
  'optional',
  'mandatory',
  'string',
  'number',
  'boolean',
  'object',
  'varchar',
  'undefined',
  'unknown',
  'password',
  'passwd',
  'passphrase',
  'secret',
  'hidden',
  'hashed',
  'encrypted',
  'protected',
  'provided',
  'generated',
  'random',
  'rotated',
  'expired',
  'changed',
  'updated',
  'invalid',
  'incorrect',
  'missing',
  'stored',
  'enabled',
  'disabled',
  'prompt',
  'prompted',
  'default',
  'sample',
  'placeholder',
  'accepted',
  'rejected',
  'matched',
  'verified',
  'success',
  'failure',
]);

/**
 * Shaped like a secret rather than a description: six characters or more,
 * not a path, and not a word that says what the field is. `hunter22`,
 * `Welcome-2026!` and `dragon` are; `required`, `String`, `vault` and
 * `/home/runner/work` are not.
 */
function isSecretShaped(value: string): boolean {
  if (value.length < 6) return false;
  // A path says where something is: `PWD=/home/runner/…`, `pwd: C:\Users\…`.
  if (/^(?:~?\/|[A-Za-z]:\\)/.test(value)) return false;
  const word = value.toLowerCase();
  return !DESCRIBES_A_PASSWORD.has(word) && !NOT_A_SECRET.has(word);
}

interface LineRule {
  name: SecretPatternName;
  re: RegExp;
  /** The capture that is the value, when the rule has one. */
  value?: number;
  /** Whether that value is a secret; a masked one never is. */
  secret?: (value: string) => boolean;
}

/**
 * The line-level rules. Built per call — each is `g`, so it carries state.
 *
 * **Every quantifier is bounded, and no two adjacent ones overlap without a
 * literal between them** (LAI-1302 review). The scan runs synchronously
 * inside the request that completes an upload, over up to 2 MiB an agent
 * chose: an unbounded `[a-z0-9+.-]*` before `://` was quadratic on a run of
 * `a.a.a.`, minutes at 2 MiB. `secret-scan.test.ts` times each rule's worst
 * case at the full size.
 */
function lineRules(): LineRule[] {
  return [
    {
      name: 'private_key',
      re: /-----BEGIN (?:[A-Z0-9]{1,16} ){0,4}PRIVATE KEY(?: BLOCK)?-----/g,
    },
    { name: 'aws_access_key_id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
    {
      name: 'aws_secret_access_key',
      re: /aws_?secret_?access_?key["']?[ \t]{0,8}[:=][ \t]{0,8}["']?([A-Za-z0-9/+=]{40})(?![A-Za-z0-9/+=])/gi,
      value: 1,
    },
    { name: 'laika_token', re: /\blai_[0-9A-Za-z]{40}\b/g },
    {
      name: 'github_token',
      re: /\b(?:(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g,
    },
    { name: 'sk_token', re: /\bsk-[A-Za-z0-9_-]{20,200}/g },
    {
      // One secret-shaped token that ends its line, its quotes or its field,
      // or stands before a note in brackets: `password: hunter22`,
      // `"password": "hunter22",`, `password: hunter22 (temp)` — never prose
      // such as `Password: stored in the team vault`.
      name: 'password_value',
      re: /\b(?:password|passwd|pwd|passphrase)\b["']?[ \t]{0,8}[:=][ \t]{0,8}["']?([^\s"',;<>{}#]{4,128})["']?[ \t]{0,8}(?=$|[,;}\]#]|\([^()\n]{0,64}\)[ \t]{0,8}(?:$|[,;}\]#]))/gim,
      value: 1,
      secret: isSecretShaped,
    },
    {
      // The same value as an XML element — `<password>hunter22</password>`,
      // `<db:adminPassword type="x">…</db:adminPassword>` — its text one
      // secret-shaped token.
      name: 'password_value',
      re: /<(?:[A-Za-z_][\w.:-]{0,31})?(?:password|passwd|pwd|passphrase)(?:[ \t][^<>\n]{0,256})?>[ \t]{0,8}([^\s<>]{4,128})[ \t]{0,8}<\//gi,
      value: 1,
      secret: isSecretShaped,
    },
    {
      name: 'env_secret',
      re: /^[ \t]{0,16}(?:export[ \t]{1,8})?(?:[A-Z][A-Z0-9_]{0,63}_)?(?:SECRET|SECRET_KEY|SECRET_ACCESS_KEY|PASSWORD|PASSWD|PASS|TOKEN|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET)[ \t]{0,8}=[ \t]{0,8}["']?([^\s"'#]{4,256})/gm,
      value: 1,
    },
    {
      name: 'url_credentials',
      // A scheme starts where no scheme character precedes it, so a run of
      // `a.a.a.` is tried once, not once per letter.
      re: /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/@]{1,256}:([^\s:/@]{1,256})@[^\s/]{1,256}/gi,
      value: 1,
    },
  ];
}

/**
 * Whether a header cell names a column of credentials: `'named'` for
 * `password`, `Temp password`, `api_key`, `clientSecret`, `access_token`;
 * `'bare'` for a bare `pass` or `token`, which a test report's
 * `suite,pass,fail` and a word list's `token` are too; `null` for anything
 * else. One or two words, so a sentence that mentions a password is not read
 * as a header.
 */
function credentialColumn(cell: string): 'named' | 'bare' | null {
  const words = cell
    .toLowerCase()
    .split(/[\s_.-]+/)
    .filter((w) => w !== '');
  if (words.length === 0 || words.length > 2) return null;
  const n = words.join('');
  if (n.length > 30 || /[^a-z0-9]/.test(n)) return null;
  if (n === 'pass' || n === 'token') return 'bare';
  if (n.includes('password') || n.includes('passwd') || n.includes('passphrase')) return 'named';
  if (n === 'pwd') return 'named';
  if (['apikey', 'secretkey', 'privatekey', 'accesskey'].some((end) => n.endsWith(end))) {
    return 'named';
  }
  // `access_token`, `api token`, `refreshToken` — a token of some kind.
  return n.endsWith('secret') || n.endsWith('token') ? 'named' : null;
}

/**
 * A credential column's cell that holds no secret: masked, empty, a number,
 * a result word, shorter than four characters, or prose — more than one word,
 * such as `see vault`.
 */
function isNotSecretCell(value: string): boolean {
  const v = value.trim();
  if (v.length < 4 || isMasked(v)) return true;
  if (/\s/.test(v)) return true;
  if (/^[-+]?[\d.,:%]+$/.test(v)) return true;
  return NOT_A_SECRET.has(v.toLowerCase());
}

/**
 * Whether a cell holds a secret: under a named column, any that is not
 * `isNotSecretCell`; under a bare `pass` or `token`, only one that reads as a
 * credential — eight characters or more, letters and digits both, as
 * `Welcome-2026!` and `abc123def456` do and a count, a result or a word
 * never does.
 */
function isSecretCell(value: string, kind: 'named' | 'bare'): boolean {
  if (isNotSecretCell(value)) return false;
  if (kind === 'named') return true;
  const v = value.trim();
  return v.length >= 8 && /[A-Za-z]/.test(v) && /\d/.test(v);
}

const DELIMITERS = [',', '\t', ';', '|'] as const;

/** A header row is short: a longer line is never read as one. */
const MAX_HEADER = 1024;

/** The first `limit` cells of a row — enough for the columns asked about, and no more. */
function cells(line: string, delimiter: string, limit?: number): string[] {
  const parts = line.split(delimiter, limit).map((c) => {
    const cell = c.trim();
    // Its quotes off, `"…"`: a plain test, as this runs on every cell of every row.
    return cell.length >= 2 && cell.startsWith('"') && cell.endsWith('"')
      ? cell.slice(1, -1)
      : cell;
  });
  // A markdown table row starts and ends with its delimiter.
  if (delimiter === '|') {
    if (parts[0] === '') parts.shift();
    if (parts.at(-1) === '') parts.pop();
  }
  return parts;
}

/**
 * A table — CSV, TSV, a markdown table — with a column named for a
 * credential and an unmasked value under it. A header row starts a table and
 * a blank line ends it, so a table in the middle of a report is read too.
 */
function credentialTable(lines: readonly string[]): SecretHit | null {
  let table: {
    delimiter: string;
    columns: { at: number; kind: 'named' | 'bare' }[];
    limit: number;
  } | null = null;
  for (const [i, line] of lines.entries()) {
    if (line.trim() === '') {
      table = null;
      continue;
    }
    if (table !== null) {
      const row = cells(line, table.delimiter, table.limit);
      if (table.columns.some(({ at, kind }) => isSecretCell(row[at] ?? '', kind))) {
        return { pattern: 'credential_column', line: i + 1 };
      }
      continue;
    }
    if (line.length > MAX_HEADER) continue;
    for (const delimiter of DELIMITERS) {
      // A line without the delimiter is one cell, never a header: not split.
      if (!line.includes(delimiter)) continue;
      const header = cells(line, delimiter);
      if (header.length < 2 || header.some((name) => name.length > 40)) continue;
      const columns = header.flatMap((name, at) => {
        const kind = credentialColumn(name);
        return kind === null ? [] : [{ at, kind }];
      });
      if (columns.length > 0) {
        // A markdown row's leading `|` is one more cell before the split drops it.
        table = { delimiter, columns, limit: Math.max(...columns.map(({ at }) => at)) + 2 };
        break;
      }
    }
  }
  return null;
}

/** The first secret `text` holds, by line, or `null`. */
export function scanForSecrets(text: string): SecretHit | null {
  const lines = text.split(/\r\n|\r|\n/);
  let first: SecretHit | null = null;

  for (const rule of lineRules()) {
    for (const match of text.matchAll(rule.re)) {
      const value = rule.value === undefined ? undefined : match[rule.value];
      if (value !== undefined && isMasked(value)) continue;
      if (value !== undefined && rule.secret !== undefined && !rule.secret(value)) continue;
      const line = text.slice(0, match.index).split(/\r\n|\r|\n/).length;
      if (first === null || line < first.line) first = { pattern: rule.name, line };
      break;
    }
  }

  const table = credentialTable(lines);
  if (table !== null && (first === null || table.line < first.line)) first = table;
  return first;
}
