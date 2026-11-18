import { describe, expect, it } from 'vitest';
import {
  addressToken,
  aligned,
  authservIds,
  authVerdict,
  INBOUND_ATTACHMENTS_MAX,
  INBOUND_TITLE_MAX,
  isAutomatic,
  messageIdsIn,
  NO_SUBJECT,
  parseAuthenticationResults,
  readHeaders,
  readInboundMail,
  storedMessageId,
  subjectKey,
  taskTitle,
  trimQuoted,
} from '../../src/services/email-inbound-parse.ts';

/**
 * Reading Brevo's inbound mail (D-155, LAI-1315). These are the rules a forged
 * sender, a loop or a malformed delivery is judged by, each on its own.
 */

const ADDRESS = 'rmb-ab3de7fgh2jk@tasks.kvelld.com';

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Uuid: ['u-1'],
    MessageId: '<m-1@mail.example.com>',
    InReplyTo: null,
    From: { Name: 'Ada', Address: 'Ada@Example.com' },
    To: [{ Name: null, Address: ADDRESS }],
    Recipients: [{ Name: null, Address: ADDRESS.toUpperCase() }],
    Cc: [],
    Subject: 'Login is broken',
    RawTextBody: 'It fails.\n\nOn Mon, 1 Jan 2026 at 10:00, Bob <b@x.com> wrote:\n> old text',
    ExtractedMarkdownMessage: '',
    Spam: { Score: 0.4 },
    Attachments: [],
    Headers: { 'Message-ID': '<m-1@mail.example.com>' },
    ...overrides,
  };
}

describe('headers', () => {
  it('reads Brevo’s object, a value seen twice as a list, names in any case', () => {
    const h = readHeaders({
      'Authentication-Results': ['mx.a; dmarc=pass', 'mx.b; dmarc=fail'],
      'X-Thing': 'one\r\n two',
      Bad: 7,
    });
    expect(h.get('authentication-results')).toEqual(['mx.a; dmarc=pass', 'mx.b; dmarc=fail']);
    expect(h.get('x-thing')).toEqual(['one two']);
    expect(h.has('bad')).toBe(false);
  });

  it('reads a list of Name: value lines too, and nothing else', () => {
    const h = readHeaders(['Precedence: bulk', 'nonsense', 42]);
    expect(h.get('precedence')).toEqual(['bulk']);
    expect(h.size).toBe(1);
    expect(readHeaders('nope').size).toBe(0);
  });
});

describe('message ids', () => {
  it('finds every bracketed id, or one bare id', () => {
    expect(messageIdsIn('<a@b> <c@d>\t<e@f>')).toEqual(['a@b', 'c@d', 'e@f']);
    expect(messageIdsIn(' x@y ')).toEqual(['x@y']);
    expect(messageIdsIn('two words')).toEqual([]);
  });

  it('stores an id without brackets, and a digest of one too long to index', () => {
    expect(storedMessageId(' <a@b> ')).toBe('a@b');
    const long = storedMessageId(`<${'x'.repeat(600)}@b>`);
    expect(long).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('readInboundMail', () => {
  it('normalises one item: lower-case sender, recipients once, quoted history trimmed', () => {
    const mail = readInboundMail(item())!;
    expect(mail.messageId).toBe('m-1@mail.example.com');
    expect(mail.from).toBe('ada@example.com');
    expect(mail.recipients).toEqual([ADDRESS]);
    expect(mail.subject).toBe('Login is broken');
    expect(mail.text).toBe('It fails.');
    expect(mail.spamScore).toBe(0.4);
    expect(mail.replyTo).toEqual([]);
  });

  it('prefers Brevo’s extracted text, and reads the thread from InReplyTo and References', () => {
    const mail = readInboundMail(
      item({
        ExtractedMarkdownMessage: '  Thanks, **fixed**.  ',
        InReplyTo: '<m-0@mail.example.com>',
        Headers: { References: '<root@x> <m-0@mail.example.com>' },
      }),
    )!;
    expect(mail.text).toBe('Thanks, **fixed**.');
    expect(mail.replyTo).toEqual(['m-0@mail.example.com', 'root@x']);
  });

  it('gives a mail with no Message-ID the same digest each time it arrives', () => {
    const a = readInboundMail(item({ MessageId: '' }))!;
    const b = readInboundMail(item({ MessageId: undefined }))!;
    expect(a.messageId).toMatch(/^digest:[0-9a-f]{64}$/);
    expect(b.messageId).toBe(a.messageId);
    expect(readInboundMail(item({ MessageId: '', Subject: 'Other' }))!.messageId).not.toBe(
      a.messageId,
    );
  });

  it('takes a sender only when it is a plain address', () => {
    expect(readInboundMail(item({ From: { Address: 'Ada <ada@example.com>' } }))!.from).toBeNull();
    expect(readInboundMail(item({ From: 'ada@example.com' }))!.from).toBeNull();
    expect(readInboundMail(item({ From: null }))!.from).toBeNull();
  });

  it('keeps at most twenty attachments, each with a token, a safe type and a size', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({
      Name: `f${String(i)}.pdf`,
      ContentType: 'application/pdf',
      ContentLength: 1200,
      DownloadToken: `tok-${String(i)}`,
    }));
    const mail = readInboundMail(
      item({
        Attachments: [
          {
            Name: '',
            ContentType: 'text/html; charset="x"',
            ContentLength: -3,
            DownloadToken: 'a',
          },
          { Name: 'no-token.txt', ContentType: 'text/plain' },
          ...many,
        ],
      }),
    )!;
    expect(mail.attachments).toHaveLength(INBOUND_ATTACHMENTS_MAX);
    expect(mail.attachments[0]).toEqual({
      filename: 'attachment',
      contentType: 'application/octet-stream',
      sizeBytes: 0,
      downloadToken: 'a',
    });
  });

  it('reads both payload shapes Brevo sends (F1): plain-address lists and a top-level SpamScore', () => {
    const mail = readInboundMail(
      item({ Recipients: [ADDRESS, 'not an address'], Spam: undefined, SpamScore: 6.5 }),
    )!;
    expect(mail.recipients).toEqual([ADDRESS]);
    expect(mail.spamScore).toBe(6.5);
  });

  it('matches on the envelope, so a Bcc’d space is found; To and Cc only without one', () => {
    const bcc = readInboundMail(
      item({ To: [{ Address: 'someone@else.example' }], Recipients: [{ Address: ADDRESS }] }),
    )!;
    expect(bcc.recipients).toEqual([ADDRESS]);
    const noEnvelope = readInboundMail(
      item({ Recipients: [], To: [{ Address: ADDRESS }], Cc: [{ Address: 'b@x.example' }] }),
    )!;
    expect(noEnvelope.recipients).toEqual([ADDRESS, 'b@x.example']);
  });

  it('is null for anything that is not an object', () => {
    expect(readInboundMail(null)).toBeNull();
    expect(readInboundMail('mail')).toBeNull();
    expect(readInboundMail([item()])).toBeNull();
  });
});

describe('the text a task or comment takes', () => {
  it('trims quoted history, an Outlook block, and lines quoted with >', () => {
    expect(trimQuoted('Yes.\n> no\nok\n-----Original Message-----\nFrom: x')).toBe('Yes.\nok');
    expect(trimQuoted('Done\n\n________________________________\nFrom: someone')).toBe('Done');
  });

  it('names a task after its subject, on one line, capped — or (no subject)', () => {
    expect(taskTitle('  Login\r\n  broken\u0007 ')).toBe('Login broken');
    expect(taskTitle('')).toBe(NO_SUBJECT);
    expect([...taskTitle('é'.repeat(400))]).toHaveLength(INBOUND_TITLE_MAX);
  });

  it('finds a task key in brackets', () => {
    expect(subjectKey('Re: [RMB-42] Login')).toBe('RMB-42');
    expect(subjectKey('RMB-42 without brackets')).toBeNull();
  });
});

describe('the space’s address', () => {
  it('reads only the twelve-character token, at the board’s domain', () => {
    expect(addressToken(ADDRESS, 'tasks.kvelld.com')).toBe('ab3de7fgh2jk');
    expect(addressToken('renamed-space-ab3de7fgh2jk@tasks.kvelld.com', 'TASKS.kvelld.com')).toBe(
      'ab3de7fgh2jk',
    );
    expect(addressToken(ADDRESS, 'kvelld.com')).toBeNull();
    expect(addressToken('rmb-ab3de7fgh2j1@tasks.kvelld.com', 'tasks.kvelld.com')).toBeNull();
    expect(addressToken('rmb@tasks.kvelld.com', 'tasks.kvelld.com')).toBeNull();
  });
});

describe('machines answering mail (auto_reply)', () => {
  it('drops auto-replies, bounces and list mail, and keeps a person’s mail', () => {
    expect(isAutomatic(readHeaders({ 'Auto-Submitted': 'auto-replied' }))).toBe(true);
    expect(isAutomatic(readHeaders({ 'Auto-Submitted': 'no' }))).toBe(false);
    expect(isAutomatic(readHeaders({ Precedence: 'Bulk' }))).toBe(true);
    expect(isAutomatic(readHeaders({ 'X-Autoreply': 'yes' }))).toBe(true);
    expect(isAutomatic(readHeaders({ 'Return-Path': '<>' }))).toBe(true);
    expect(isAutomatic(readHeaders({ 'Return-Path': '<ada@example.com>' }))).toBe(false);
  });
});

describe('Authentication-Results', () => {
  it('parses a real-shaped header, comments and all', () => {
    const parsed = parseAuthenticationResults(
      'mx.brevo.example 1; dkim=pass (2048-bit key; unprotected) header.d=example.com header.i=@example.com; ' +
        'spf=pass (domain of b@example.com designates 1.2.3.4) smtp.mailfrom=b@example.com; ' +
        'dmarc=pass (p=REJECT sp=NONE) header.from=Example.com',
    )!;
    expect(parsed.authservId).toBe('mx.brevo.example');
    expect(parsed.results.map((r) => `${r.method}=${r.result}`)).toEqual([
      'dkim=pass',
      'spf=pass',
      'dmarc=pass',
    ]);
    expect(parsed.results[2]?.props.get('header.from')).toBe('example.com');
    expect(parseAuthenticationResults('; dmarc=pass')).toBeNull();
  });

  it('strict alignment (F5): exactly the From domain — no parent, no subdomain, no bare suffix', () => {
    expect(aligned('example.com', 'example.com')).toBe(true);
    expect(aligned('Example.com.', 'example.com')).toBe(true);
    expect(aligned('mail.example.com', 'example.com')).toBe(false);
    expect(aligned('example.com', 'eu.example.com')).toBe(false);
    expect(aligned('co.za', 'kvelld.co.za')).toBe(false);
    expect(aligned('com', 'com')).toBe(false);
  });

  const verdict = (ar: unknown, from = 'ada@example.com', server: string | null = 'mx.b') =>
    authVerdict(readHeaders({ 'Authentication-Results': ar }), from, server);

  it('passes on DMARC for the From domain, a DKIM signature by it, or SPF for it', () => {
    expect(verdict('mx.b; dmarc=pass header.from=example.com').pass).toBe(true);
    expect(verdict('mx.b; dmarc=pass header.from=<ada@example.com>').pass).toBe(true);
    expect(verdict('mx.b; dkim=pass header.d=example.com').pass).toBe(true);
    expect(verdict('mx.b; dkim=pass header.i=@example.com').pass).toBe(true);
    expect(verdict('mx.b; spf=pass smtp.mailfrom=bounce@example.com').pass).toBe(true);
  });

  it('fails a forged From: every pass is for another domain, or only a related one', () => {
    expect(verdict('mx.b; dmarc=pass header.from=attacker.example').pass).toBe(false);
    expect(verdict('mx.b; dkim=pass header.d=attacker.example').pass).toBe(false);
    expect(verdict('mx.b; dkim=pass header.d=mail.example.com').pass).toBe(false);
    expect(verdict('mx.b; spf=pass smtp.mailfrom=x@attacker.example').pass).toBe(false);
    expect(verdict('mx.b; spf=pass smtp.helo=example.com').pass).toBe(false);
    expect(verdict('mx.b; dmarc=fail header.from=example.com; dkim=none').pass).toBe(false);
    expect(authVerdict(readHeaders({}), 'ada@example.com', 'mx.b')).toEqual({
      pass: false,
      summary: null,
    });
  });

  it('with no receiving server named, believes nothing — there is no topmost fallback (M1)', () => {
    // If the receiving server stamps nothing, the topmost header is the forger's.
    expect(verdict('mx.b; dmarc=pass header.from=example.com', 'ada@example.com', null)).toEqual({
      pass: false,
      summary: null,
    });
  });

  it('believes only the first header carrying the named server — later ones, forged or not, count for nothing', () => {
    // The receiving server's verdict first, a forger's copy with the same id under it.
    expect(
      verdict([
        'mx.b; dmarc=fail header.from=example.com',
        'mx.b; dmarc=pass header.from=example.com',
      ]),
    ).toEqual({ pass: false, summary: 'mx.b dmarc=fail' });
    // A forger's header above it, naming another server: not the receiver's.
    expect(
      verdict([
        'mx.attacker; dmarc=pass header.from=example.com',
        'mx.b; dmarc=fail header.from=example.com',
      ]).pass,
    ).toBe(false);
    // The named server's pass, wherever it is, is the one that counts.
    expect(
      verdict(
        ['mx.attacker; dmarc=fail', 'mx.brevo.example; dmarc=pass header.from=example.com'],
        'ada@example.com',
        'MX.BREVO.EXAMPLE',
      ).pass,
    ).toBe(true);
  });

  it('fails closed on headers whose order is lost: two keys for one header, or a value it cannot read', () => {
    const pass = 'mx.b; dmarc=pass header.from=example.com';
    const twoKeys = readHeaders({ 'Authentication-Results': pass, 'authentication-results': pass });
    expect(twoKeys.ambiguous.has('authentication-results')).toBe(true);
    expect(authVerdict(twoKeys, 'ada@example.com', 'mx.b').pass).toBe(false);
    expect(verdict([pass, 7]).pass).toBe(false);
    expect(verdict({ text: pass }).pass).toBe(false);
    // Lines keep the mail's order: the same name twice is just two headers.
    const lines = readHeaders([
      `Authentication-Results: ${pass}`,
      'authentication-results: x; none',
    ]);
    expect(lines.ambiguous.size).toBe(0);
    expect(authVerdict(lines, 'ada@example.com', 'mx.b').pass).toBe(true);
  });

  it('lists the servers a mail named, topmost first, each once', () => {
    expect(
      authservIds(
        readHeaders({
          'Authentication-Results': [
            'MX.b; dmarc=pass',
            'mx.c; spf=none',
            'mx.b; dkim=pass',
            '; x',
          ],
        }),
      ),
    ).toEqual(['mx.b', 'mx.c']);
  });

  it('summarises the believed verdicts in a line safe to keep: names and words only', () => {
    const { summary } = verdict(
      'mx.b; dkim=pass header.d=example.com; spf=softfail smtp.mailfrom=x@y; arc=none; dmarc=pass header.from=example.com',
    );
    expect(summary).toBe('mx.b dkim=pass spf=softfail dmarc=pass');
  });
});
