import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { isKeyName, scanFile } from '../src/attach-scan.ts';
import { officeText } from '../src/office-text.ts';
import {
  SECRET_PATTERNS,
  SECRET_SCAN_BYTES,
  type SecretPatternName,
  scanForSecrets,
} from '../src/secret-scan.ts';
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

  void test('a key file is read as text: a private key is refused, a certificate passes', () => {
    assert.deepEqual(scanFile('id_ed25519', Buffer.from(`${KEY_BLOCK}\nb3Bl\n`)), {
      ok: false,
      pattern: 'private_key',
      where: 'line 1',
    });
    const cert = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----\n';
    assert.deepEqual(scanFile('server.pem', Buffer.from(cert)), { ok: true, scanned: 'text' });
    assert.deepEqual(scanFile('id_rsa.pub', Buffer.from('ssh-ed25519 AAAAC3Nz ada\n')), {
      ok: true,
      scanned: 'text',
    });
  });

  void test('a binary key, or any keystore, is refused by its name', () => {
    for (const name of ['id_rsa', 'tls.key', 'server.pem', 'deploy.p12', 'cert.pfx', 'app.jks']) {
      assert.deepEqual(scanFile(name, Buffer.from([0x30, 0x82, 0, 1])), {
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

void describe('what D-162 tells an agent to write passes, and the same shape with a real one does not (the board’s cases)', () => {
  // The server's pairs (LAI-1302 review), rule for rule: the fix narrowed
  // each rule rather than removing it, here as there.
  const cases: [string, string, string, SecretPatternName][] = [
    [
      'a note on where the password lives',
      'Password: stored in the team vault',
      'Password: Hunter2-but-longer',
      'password_value',
    ],
    [
      'a password column that says where it is',
      'account,password\nprod db,see vault',
      'account,password\nprod db,Hunter2!x',
      'credential_column',
    ],
    [
      'a CSV test report',
      'suite,pass,fail\nunit,120,0',
      'suite,api_token\nunit,abc123def456',
      'credential_column',
    ],
    [
      'a markdown test report',
      '| Suite | Pass | Fail |\n|---|---|---|\n| unit | 120 | 0 |',
      '| Suite | Password |\n|---|---|\n| unit | Welcome-1 |',
      'credential_column',
    ],
  ];
  for (const [what, clean, secret, pattern] of cases) {
    void test(`passes ${what}, and still catches a real one in the same shape`, () => {
      assert.equal(scanForSecrets(clean), null, clean);
      assert.equal(scanForSecrets(secret)?.pattern, pattern, secret);
    });
  }

  void test('takes a password value only as one secret-shaped token, not a word', () => {
    for (const clean of [
      'password: required',
      'The password: see the runbook.',
      '"password": "in 1Password"',
    ]) {
      assert.equal(scanForSecrets(clean), null, clean);
    }
    for (const secret of [
      '"password": "hunter22",',
      'password = correcthorsebatterystaple',
      "db.password='Pa55word' # local",
    ]) {
      assert.equal(scanForSecrets(secret)?.pattern, 'password_value', secret);
    }
  });
});

/**
 * Each rule's worst case at the size the board reads, ported from the
 * server's test (LAI-1302 review). The CLI reads a whole file, so a rule that
 * went quadratic would hold `laika attach` for minutes on a crafted one; the
 * `url_credentials` rule this list replaced took about 1.5 s on 80k characters
 * of `a.`.
 */
void describe('every rule is linear on a crafted 2 MiB file', () => {
  const fill = (unit: string, prefix = ''): string =>
    (prefix + unit.repeat(Math.ceil(SECRET_SCAN_BYTES / unit.length))).slice(0, SECRET_SCAN_BYTES);

  const WORST: Record<SecretPatternName, string> = {
    private_key: fill('A ', '-----BEGIN '),
    aws_access_key_id: fill('AKIA'),
    aws_secret_access_key: fill(' ', 'aws_secret_access_key'),
    laika_token: fill('lai_'),
    github_token: fill('a', 'ghp_'),
    sk_token: fill('sk-'),
    password_value: fill('\t', 'password: abcd'),
    env_secret: fill('A_A_A_A_A_A_A_A_A_A_A_A_A_A_A_A\n'),
    url_credentials: fill('a.'),
    credential_column: fill(',****\n', 'a,password\n'),
  };

  void test('scans each in well under a second, and all of them within 1.5 s', () => {
    assert.deepEqual(Object.keys(WORST).sort(), [...SECRET_PATTERNS].sort());
    let total = 0;
    for (const [pattern, text] of Object.entries(WORST)) {
      assert.equal(text.length, SECRET_SCAN_BYTES, pattern);
      const started = performance.now();
      scanForSecrets(text);
      const took = performance.now() - started;
      assert.ok(took < 750, `${pattern} took ${took.toFixed(0)} ms`);
      total += took;
    }
    assert.ok(total < 1500, `all of them took ${total.toFixed(0)} ms`);
  });
});

void describe('office files are read in linear time, and what cannot be read is refused', () => {
  const MIB2 = 2 * 1024 * 1024;
  const fill = (unit: string, prefix = '', suffix = ''): string =>
    prefix + unit.repeat(Math.ceil((MIB2 - prefix.length - suffix.length) / unit.length)) + suffix;
  const sheetOf = (xml: string): Buffer =>
    zip({
      'xl/workbook.xml': '<workbook/>',
      'xl/worksheets/sheet1.xml': xml,
    });
  const docOf = (xml: string): Buffer => zip({ 'word/document.xml': xml });

  // Each crafted the way a lazy `[\s\S]*?…</x>` pattern goes quadratic: many
  // openings and no closing — 80k unclosed rows took 4 s before (LAI-1351 review).
  const CRAFTED: Record<string, Buffer> = {
    'unclosed rows': sheetOf(fill('<row>', '<worksheet><sheetData>')),
    'unclosed cells in a row': sheetOf(fill('<c ', '<sheetData><row>', '</row>')),
    'unclosed shared strings': zip({
      'xl/workbook.xml': '<workbook/>',
      'xl/sharedStrings.xml': fill('<si><t>', '<sst>'),
    }),
    'unclosed Word tags': docOf(fill('<w:p ', '<w:document><w:body>')),
    'unclosed Word text runs': docOf(fill('<w:t>a', '<w:document><w:body><w:p>')),
    'one long run of references': docOf(fill('&#x41;', '<w:p><w:r><w:t>', '</w:t></w:r></w:p>')),
    'many closed rows': sheetOf(
      fill('<row><c t="inlineStr"><is><t>ok</t></is></c></row>', '<sheetData>', '</sheetData>'),
    ),
  };

  void test('each crafted 2 MiB part is read or refused in well under a second, all within 1.5 s', () => {
    let total = 0;
    for (const [what, file] of Object.entries(CRAFTED)) {
      const started = performance.now();
      scanFile('crafted.xlsx', file);
      const took = performance.now() - started;
      assert.ok(took < 750, `${what} took ${took.toFixed(0)} ms`);
      total += took;
    }
    assert.ok(total < 1500, `all of them took ${total.toFixed(0)} ms`);
  });

  void test('an unclosed element is unreadable, so what follows it never passes unscanned', () => {
    const token = ['gh', 'p_', 'Zz9'.repeat(12)].join('');
    // Row 2 never closes: stopping there would leave its token unread.
    const sheet = sheetOf(
      `<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row><row r="2"><c t="inlineStr"><is><t>${token}</t></is></c></sheetData>`,
    );
    assert.deepEqual(scanFile('cut.xlsx', sheet), {
      ok: false,
      pattern: 'unreadable',
      where: 'its contents',
    });
    assert.equal(officeText(CRAFTED['unclosed rows'] ?? Buffer.alloc(0)), undefined);
  });

  void test('a reference to no character is unreadable, not a crash', () => {
    const doc = docOf(
      '<w:document><w:body><w:p><w:r><w:t>&#x110000;</w:t></w:r></w:p></w:body></w:document>',
    );
    assert.deepEqual(scanFile('bad.docx', doc), {
      ok: false,
      pattern: 'unreadable',
      where: 'its contents',
    });
  });

  void test('a spreadsheet written with a namespace prefix is read all the same', () => {
    const token = ['gh', 'p_', 'Zz9'.repeat(12)].join('');
    const sheet = sheetOf(
      `<x:worksheet><x:sheetData><x:row r="1"><x:c t="inlineStr"><x:is><x:t>ok</x:t></x:is></x:c></x:row><x:row r="2"><x:c t="inlineStr"><x:is><x:t>${token}</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>`,
    );
    assert.deepEqual(scanFile('prefixed.xlsx', sheet), {
      ok: false,
      pattern: 'github_token',
      where: 'sheet 1, row 2',
    });
  });

  void test('parts that together pass the total budget are unreadable, each under the part limit', () => {
    const big = `<sheetData>${'<row><c t="inlineStr"><is><t>ok</t></is></c></row>'.repeat(4000)}</sheetData>`;
    const three = zip({
      'xl/workbook.xml': '<workbook/>',
      'xl/worksheets/sheet1.xml': big,
      'xl/worksheets/sheet2.xml': big,
      'xl/worksheets/sheet3.xml': big,
    });
    const limits = { part: big.length + 1, total: big.length * 2 + 100 };
    assert.equal(officeText(three, limits), undefined);
    assert.equal(
      officeText(three, { part: big.length + 1, total: big.length * 3 + 100 })?.length,
      3,
    );
  });
});
