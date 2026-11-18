import { describe, expect, it } from 'vitest';
import {
  isScannedFile,
  SECRET_PATTERNS,
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
    ] as const) {
      expect(isScannedFile(type, name), `${type} ${name}`).toBe(true);
    }
  });

  it('leaves images, documents and recordings alone', () => {
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
