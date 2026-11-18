import { describe, expect, it } from 'vitest';
import {
  isScannedFile,
  SECRET_PATTERNS,
  SECRET_SCAN_BYTES,
  type SecretPatternName,
  scanForSecrets,
} from '../../src/services/secret-scan.ts';

/**
 * The secret check's probe (§13.4, D-162 item 4, LAI-1302): one sample per
 * rule that it must catch, and the clean and the masked files it must pass.
 *
 * **Every sample is built at run time**, from pieces no scanner would flag on
 * its own, so this file never holds a string shaped like a real credential —
 * neither for GitHub's push protection nor for anybody grepping the repo.
 * The CLI's copy of the list (LAI-1351) is held to these same names.
 */

const AWS_ID = ['AK', 'IA', 'Q'.repeat(16)].join('');
const AWS_SECRET = 'wJalr' + 'Q'.repeat(30) + 'EXAMP';
const LAIKA = ['lai', '_', 'Ab3'.repeat(13), 'x'].join('');
const GITHUB = ['gh', 'p_', 'Zz9'.repeat(12)].join('');
const SK = ['s', 'k-', 'proj-', 'Q7'.repeat(12)].join('');
const KEY_BLOCK = ['-----BEGIN ', 'OPENSSH ', 'PRIVATE KEY-----'].join('');

/** One sample each rule must catch, on line 2, after a clean line. */
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

describe('every rule catches its sample, by name and line', () => {
  it('has a probe for each rule, and no probe for a rule that is not there', () => {
    expect(Object.keys(PROBES).sort()).toEqual([...SECRET_PATTERNS].sort());
  });

  for (const pattern of SECRET_PATTERNS) {
    it(pattern, () => {
      // github_token's sample is a URL with credentials too, on the same line:
      // a tie goes to the rule earlier in the list, which names the token.
      expect(scanForSecrets(PROBES[pattern])).toEqual({ pattern, line: 2 });
    });
  }

  it('names the token rules on a line that carries nothing else', () => {
    expect(scanForSecrets(`a\n${GITHUB}`)).toEqual({ pattern: 'github_token', line: 2 });
    expect(scanForSecrets(`a\n${LAIKA}`)).toEqual({ pattern: 'laika_token', line: 2 });
  });

  it('answers the rule and the line, and never the text it matched', () => {
    const hit = scanForSecrets(PROBES.env_secret);
    expect(hit).toEqual({ pattern: 'env_secret', line: 2 });
    expect(JSON.stringify(hit)).not.toContain('s3cr3t');
  });

  it('reports the earliest line when a file holds several', () => {
    expect(scanForSecrets(`ok\nok\npassword=first-one\n${AWS_ID}`)).toEqual({
      pattern: 'password_value',
      line: 3,
    });
  });

  it('reads a markdown table and a TSV as it reads a CSV', () => {
    expect(
      scanForSecrets('# Accounts\n\n| user | password |\n|---|---|\n| ada | Welcome-1 |'),
    ).toEqual({ pattern: 'credential_column', line: 5 });
    expect(scanForSecrets('user\tapi_key\nada\tabc123def456')).toEqual({
      pattern: 'credential_column',
      line: 2,
    });
  });
});

describe('a clean file, and a masked one, pass', () => {
  it('passes a CSV of accounts with no credential in it', () => {
    expect(
      scanForSecrets(
        'name,email,role,created\nAda,ada@example.test,owner,2026-11-19\nBrin,brin@example.test,member,2026-11-19',
      ),
    ).toBeNull();
  });

  it('passes the masked copy D-162 asks an agent to attach', () => {
    const masked = [
      'email,password,api_key',
      'ada@example.test,********,<redacted>',
      'brin@example.test,••••••••,',
      '',
      'DATABASE_PASSWORD=${DATABASE_PASSWORD}',
      'GITHUB_TOKEN=****',
      'password: [redacted]',
      'postgres://laika:${PW}@db.example.test/laika',
    ].join('\n');
    expect(scanForSecrets(masked)).toBeNull();
  });

  it('does not read a sentence that mentions a password as a table header', () => {
    expect(
      scanForSecrets('Set the password, then sign in.\nAfter that, open the board.'),
    ).toBeNull();
  });

  it('passes a test report and a settings file with nothing secret in them', () => {
    expect(
      scanForSecrets(
        [
          '✓ refuses a wrong password (12 ms)',
          '✓ TOKEN_TTL is an hour',
          'TOKEN_TTL=3600',
          'password_hash: argon2id',
          'Tests 42 passed',
        ].join('\n'),
      ),
    ).toBeNull();
  });
});

describe('what D-162 tells an agent to write is not refused (LAI-1302 review)', () => {
  // Each pair: the note or report an agent is told to attach in place of the
  // secret, which must pass, and the same shape holding a real one, which
  // must still be caught — so the fix narrowed the rule rather than removing it.
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
    it(`passes ${what}, and still catches a real one in the same shape`, () => {
      expect(scanForSecrets(clean), clean).toBeNull();
      expect(scanForSecrets(secret)?.pattern, secret).toBe(pattern);
    });
  }

  it('takes a password value only as one secret-shaped token, not a word', () => {
    for (const clean of [
      'password: required',
      'The password: see the runbook.',
      '"password": "in 1Password"',
    ]) {
      expect(scanForSecrets(clean), clean).toBeNull();
    }
    for (const secret of [
      '"password": "hunter22",',
      'password = correcthorsebatterystaple',
      "db.password='Pa55word' # local",
    ]) {
      expect(scanForSecrets(secret)?.pattern, secret).toBe('password_value');
    }
  });
});

/**
 * Each rule's worst case at the full size the server reads. The scan runs
 * synchronously inside the request that completes an upload, so a rule that
 * goes quadratic on a crafted file holds the server for as long as it runs:
 * the `url_credentials` rule this replaced took about 1.5 s on 80k characters
 * of `a.` and, by its curve, some 18 minutes on 2 MiB.
 */
describe('every rule is linear on a crafted 2 MiB file (LAI-1302 review)', () => {
  const fill = (unit: string, prefix = '') =>
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

  it('scans each in well under a second, and all of them within 1.5 s', () => {
    expect(Object.keys(WORST).sort()).toEqual([...SECRET_PATTERNS].sort());
    let total = 0;
    for (const [pattern, text] of Object.entries(WORST)) {
      expect(text.length, pattern).toBe(SECRET_SCAN_BYTES);
      const started = performance.now();
      scanForSecrets(text);
      const took = performance.now() - started;
      expect(took, `${pattern} took ${took.toFixed(0)} ms`).toBeLessThan(750);
      total += took;
    }
    expect(total).toBeLessThan(1500);
  });
});

describe('which files are scanned', () => {
  it('scans text types, and text by its name whatever it was declared as', () => {
    for (const [type, name] of [
      ['text/csv', 'accounts.csv'],
      ['text/plain', 'run.log'],
      ['application/json', 'report.json'],
      ['text/markdown', 'notes.md'],
      ['text/html', 'report.html'],
      ['application/xml', 'junit.xml'],
      ['application/yaml', 'compose.yaml'],
      ['application/octet-stream', '.env'],
      ['application/octet-stream', '.env.production'],
      ['application/octet-stream', 'prod.env'],
      // Keys and credential files, by name (LAI-1302 review).
      ['application/octet-stream', 'id_rsa'],
      ['application/octet-stream', 'id_ed25519'],
      ['application/octet-stream', 'server.pem'],
      ['application/octet-stream', 'server.key'],
      ['application/octet-stream', 'credentials'],
      ['application/octet-stream', '.npmrc'],
      ['application/octet-stream', '.netrc'],
    ] as const) {
      expect(isScannedFile(type, name), `${type} ${name}`).toBe(true);
    }
  });

  it('leaves images, documents and recordings alone by name — the server still reads any whose first bytes are text', () => {
    for (const [type, name] of [
      ['image/png', 'shot.png'],
      ['application/pdf', 'report.pdf'],
      ['video/mp4', 'demo.mp4'],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'accounts.xlsx'],
    ] as const) {
      expect(isScannedFile(type, name), `${type} ${name}`).toBe(false);
    }
  });
});
