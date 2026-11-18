import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { isKeyName, scanFile } from '../src/attach-scan.ts';
import { officeText } from '../src/office-text.ts';
import { SECRET_PATTERNS, type SecretPatternName, scanForSecrets } from '../src/secret-scan.ts';
import { docx, xlsx, zip } from './support/zip.ts';

/**
 * The secret check `laika attach` runs before an upload (D-162 item 4,
 * LAI-1351): the same rules as the board's, read from more kinds of file.
 *
 * **Every sample is built at run time**, from pieces no scanner flags alone,
 * as the server's probe does, so this file never holds a string shaped like
 * a real credential.
 */

const SERVER = fileURLToPath(new URL('../../server/src/services/secret-scan.ts', import.meta.url));
const CLI = fileURLToPath(new URL('../src/secret-scan.ts', import.meta.url));

const AWS_ID = ['AK', 'IA', 'Q'.repeat(16)].join('');
const AWS_SECRET = 'wJalr' + 'Q'.repeat(30) + 'EXAMP';
const LAIKA = ['lai', '_', 'Ab3'.repeat(13), 'x'].join('');
const GITHUB = ['gh', 'p_', 'Zz9'.repeat(12)].join('');
const SK = ['s', 'k-', 'proj-', 'Q7'.repeat(12)].join('');
const KEY_BLOCK = ['-----BEGIN ', 'OPENSSH ', 'PRIVATE KEY-----'].join('');

/** One sample each rule must catch, on line 2 — the server's probe, rule for rule. */
const PROBES: Record<SecretPatternName, string> = {
  private_key: `notes\n${KEY_BLOCK}\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----`,
  aws_access_key_id: `[default]\naws_access_key_id = ${AWS_ID}`,
  aws_secret_access_key: `[default]\naws_secret_access_key = ${AWS_SECRET}`,
  laika_token: `# setup\nexport LAIKA_URL=https://laika.example.test; curl -H "Authorization: Bearer ${LAIKA}"`,
  github_token: `remote:\ngit clone https://x-access:${GITHUB}@github.example/o/r`,
  sk_token: `{\n  "openai": "${SK}"\n}`,
  password_value: `user: ada\npassword: Hunter2-but-longer`,
  env_secret: `NODE_ENV=production\nDATABASE_PASSWORD=s3cr3t-value`,
  url_credentials: `# db\npostgres://laika:pa55word-x@db.example.test:5432/laika`,
  credential_column: `email,temp password,role\nada@example.test,Welcome-2026!,owner`,
};

/** Everything from the first rule on: the part that must be the server's, word for word. */
const rulesOf = (path: string): string => {
  const text = readFileSync(path, 'utf8');
  const at = text.indexOf('/** How much of a text file is read and scanned');
  assert.ok(at > 0, `${path}: the anchor is gone — the comparison would compare nothing`);
  return text.slice(at);
};

void describe('the same list as the board', () => {
  void test('the CLI’s rules are the server’s, word for word, from the first rule on', () => {
    // A mirror: change secret-scan.ts on one side, change it on the other.
    assert.equal(rulesOf(CLI), rulesOf(SERVER));
  });

  void test('every rule the server names is one the CLI names — read from both sides', () => {
    const server = readFileSync(SERVER, 'utf8');
    const list = /export const SECRET_PATTERNS = \[([\s\S]*?)\] as const;/.exec(server)?.[1] ?? '';
    const named = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1] ?? '');
    assert.ok(named.length >= 5, 'the server’s list was not read — the probe is broken');
    assert.deepEqual([...SECRET_PATTERNS].sort(), named.sort());
    assert.deepEqual(Object.keys(PROBES).sort(), named.sort());
  });

  for (const pattern of SECRET_PATTERNS) {
    void test(`catches ${pattern} by name and line`, () => {
      assert.deepEqual(scanForSecrets(PROBES[pattern]), { pattern, line: 2 });
    });
  }
});

void describe('what is read, and how', () => {
  void test('any text is scanned whatever it is called, and the verdict never quotes it', () => {
    const verdict = scanFile('notes.weird-extension', Buffer.from(PROBES.env_secret));
    assert.deepEqual(verdict, { ok: false, pattern: 'env_secret', where: 'line 2' });
    assert.ok(!JSON.stringify(verdict).includes('s3cr3t'));
  });

  void test('a password CSV is refused, naming the line', () => {
    const csv = 'email,password,role\nada@example.test,Welcome-2026!,owner\n';
    assert.deepEqual(scanFile('accounts.csv', Buffer.from(csv)), {
      ok: false,
      pattern: 'credential_column',
      where: 'line 2',
    });
  });

  void test('an xlsx holding a token is refused, naming the sheet and the row', () => {
    const sheet = xlsx([
      ['service', 'note'],
      ['ci', 'cleared'],
      ['github', `rotate ${GITHUB} next week`],
    ]);
    assert.deepEqual(scanFile('services.xlsx', sheet), {
      ok: false,
      pattern: 'github_token',
      where: 'sheet 1, row 3',
    });
  });

  void test('an xlsx credentials sheet is refused by its column, a masked one passes', () => {
    const live = xlsx([
      ['email', 'temp password'],
      ['ada@example.test', 'Welcome-2026!'],
    ]);
    assert.deepEqual(scanFile('accounts.xlsx', live), {
      ok: false,
      pattern: 'credential_column',
      where: 'sheet 1, row 2',
    });
    const masked = xlsx([
      ['email', 'temp password'],
      ['ada@example.test', '********'],
    ]);
    assert.deepEqual(scanFile('accounts.xlsx', masked), { ok: true, scanned: 'office' });
  });

  void test('a docx is read by paragraph and by table row', () => {
    assert.deepEqual(scanFile('handover.docx', docx(['Setup notes', `aws key ${AWS_ID}`])), {
      ok: false,
      pattern: 'aws_access_key_id',
      where: 'the document, line 2',
    });
    const tabled = docx(
      ['Accounts made today:'],
      [
        ['user', 'password'],
        ['ada', 'Welcome-2026!'],
      ],
    );
    assert.equal(
      (scanFile('handover.docx', tabled) as { pattern?: string }).pattern,
      'credential_column',
    );
    assert.deepEqual(scanFile('handover.docx', docx(['All tests green.', 'See the PR.'])), {
      ok: true,
      scanned: 'office',
    });
  });

  void test('an office file it cannot open is refused, not waved through', () => {
    const broken = xlsx([['a', 'b']]).subarray(0, 60);
    assert.deepEqual(scanFile('cut.xlsx', Buffer.concat([broken, Buffer.from([0])])), {
      ok: false,
      pattern: 'unreadable',
      where: 'its contents',
    });
  });

  void test('reads a stored (uncompressed) part as it reads a deflated one', () => {
    const parts = officeText(
      zip(
        { 'word/document.xml': '<w:document><w:p><w:r><w:t>hello</w:t></w:r></w:p></w:document>' },
        true,
      ),
    );
    assert.deepEqual(
      parts?.map((p) => p.text),
      ['hello'],
    );
  });

  void test('a key is refused by its name, and a public key is not', () => {
    for (const name of ['id_rsa', 'id_ed25519', 'server.pem', 'tls.key', 'deploy.p12']) {
      assert.ok(isKeyName(name), name);
      assert.deepEqual(scanFile(name, Buffer.from([0, 1, 2])), {
        ok: false,
        pattern: 'private_key',
        where: 'its name',
      });
    }
    for (const name of ['id_rsa.pub', 'keyboard.png', 'monkey.txt', 'idea.md']) {
      assert.ok(!isKeyName(name), name);
    }
  });

  void test('a binary file with no secret-shaped name passes unread', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
    assert.deepEqual(scanFile('shot.png', png), { ok: true, scanned: 'binary' });
  });
});

void describe('what must pass: masked copies, reports and prose (no false positives)', () => {
  const passes = (name: string, text: string): void => {
    assert.deepEqual(scanFile(name, Buffer.from(text)), { ok: true, scanned: 'text' }, text);
  };

  void test('the masked copy D-162 asks for', () => {
    passes(
      'accounts.csv',
      [
        'email,password,api_key',
        'ada@example.test,********,<redacted>',
        'brin@example.test,••••••••,',
        '',
        'DATABASE_PASSWORD=${DATABASE_PASSWORD}',
        'GITHUB_TOKEN=****',
        'password: [redacted]',
        'postgres://laika:${PW}@db.example.test/laika',
      ].join('\n'),
    );
  });

  void test('a CSV of accounts with no credential in it', () => {
    passes(
      'accounts.csv',
      'name,email,role\nAda,ada@example.test,owner\nBrin,brin@example.test,member\n',
    );
  });

  void test('a test report and a settings file', () => {
    passes(
      'report.txt',
      [
        '✓ refuses a wrong password (12 ms)',
        'TOKEN_TTL=3600',
        'password_hash: argon2id',
        'Tests 42 passed',
      ].join('\n'),
    );
  });

  void test('prose that says where a password is kept', () => {
    passes(
      'handover.md',
      'Password: stored in the vault\nThe admin password is rotated monthly.\n',
    );
  });

  void test('a results table with pass and fail columns', () => {
    passes('results.csv', 'suite,pass,fail\nserver,1201,0\nweb,884,2\n');
  });

  void test('a sentence that mentions a password is not a table header', () => {
    passes('notes.md', 'Set the password, then sign in.\nAfter that, open the board.\n');
  });
});
