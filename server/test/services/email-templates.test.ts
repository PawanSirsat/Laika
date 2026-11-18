import { describe, expect, it } from 'vitest';
import {
  assignmentEmail,
  digestEmail,
  escapeHtml,
  inviteEmail,
  mentionEmail,
  resetEmail,
  testEmail,
  type TaskRef,
  validFor,
} from '../../src/services/email-templates.ts';

/**
 * The words Laika's emails say (D-153, LAI-1312): every value escaped, the
 * link in both parts, and nothing that fetches anything when a message opens.
 */

const NOW = Date.UTC(2026, 10, 18, 9, 0, 0);
const HOUR = 60 * 60 * 1000;
const brand = { product: 'Ksage', orgName: 'Kvell Dynamics' };
const LINK = 'https://ksage.kvelld.com/invite?token=abc_DEF-123';
const PREFS = 'https://ksage.kvelld.com/people?user=01USER';
const TASK: TaskRef = {
  key: 'LAI-7',
  title: 'Ship the thing',
  projectName: 'Laika',
  url: 'https://ksage.kvelld.com/task/LAI-7',
};

describe('every template', () => {
  const all = [
    inviteEmail({
      brand,
      inviterName: 'Pawan',
      acceptUrl: LINK,
      expiresAt: NOW + 168 * HOUR,
      now: NOW,
    }),
    resetEmail({
      brand,
      userName: 'Ada',
      issuerName: 'Pawan',
      resetUrl: 'https://ksage.kvelld.com/reset-password?token=xyz',
      expiresAt: NOW + 24 * HOUR,
      now: NOW,
    }),
    testEmail({ brand, userName: 'Pawan' }),
    assignmentEmail({ brand, actorName: 'Pawan', task: TASK, prefsUrl: PREFS }),
    mentionEmail({ brand, actorName: 'Pawan', task: TASK, excerpt: 'Look', prefsUrl: PREFS }),
    digestEmail({
      brand,
      userName: 'Ada',
      tasks: [{ task: TASK, lines: ['Pawan commented'] }],
      notices: ['Pawan revoked your token laptop'],
      prefsUrl: PREFS,
    }),
  ];

  it('loads nothing remote: no image, no stylesheet, no script', () => {
    for (const mail of all) {
      expect(mail.html).not.toMatch(/<img|<link|<script|url\(|@import/i);
      expect(mail.html).not.toMatch(/\ssrc=/i);
    }
  });

  it('names the board by its From name and the organisation in the footer', () => {
    for (const mail of all) {
      expect(mail.text).toContain('Ksage · Kvell Dynamics');
      expect(mail.html).toContain('Ksage · Kvell Dynamics');
    }
  });
});

describe('inviteEmail', () => {
  const mail = inviteEmail({
    brand,
    inviterName: 'Pawan',
    acceptUrl: LINK,
    expiresAt: NOW + 7 * 24 * HOUR,
    now: NOW,
  });

  it('says who invited them to what, in the subject', () => {
    expect(mail.subject).toBe('Pawan invited you to Kvell Dynamics on Ksage');
  });

  it('carries the link in the text and as the button, and says how long it works', () => {
    expect(mail.text).toContain(LINK);
    expect(mail.html).toContain(`href="${LINK}"`);
    expect(mail.text).toContain('for 7 days');
  });

  it('escapes a name somebody typed', () => {
    const hostile = inviteEmail({
      brand: { product: 'Ksage', orgName: '<b>Org</b>' },
      inviterName: '"><script>alert(1)</script>',
      acceptUrl: 'https://x.test/invite?token=a"b',
      expiresAt: NOW + 48 * HOUR,
      now: NOW,
    });
    expect(hostile.html).not.toContain('<script>');
    expect(hostile.html).not.toContain('<b>Org</b>');
    expect(hostile.html).toContain('&lt;b&gt;Org&lt;/b&gt;');
    expect(hostile.html).toContain('href="https://x.test/invite?token=a&quot;b"');
  });
});

describe('resetEmail', () => {
  it('says who issued it and that an earlier link stops working', () => {
    const mail = resetEmail({
      brand,
      userName: 'Ada',
      issuerName: 'Pawan',
      resetUrl: 'https://ksage.kvelld.com/reset-password?token=xyz',
      expiresAt: NOW + 24 * HOUR,
      now: NOW,
    });
    expect(mail.subject).toBe('Set a new password for Ksage');
    expect(mail.text).toContain('Pawan issued a link');
    expect(mail.text).toContain('for 24 hours');
    expect(mail.text).toContain('any earlier link stops working');
    expect(mail.html).toContain('href="https://ksage.kvelld.com/reset-password?token=xyz"');
  });
});

describe('testEmail', () => {
  it('says what it proves, and that mail only goes out while the switch is on', () => {
    const mail = testEmail({ brand, userName: 'Pawan' });
    expect(mail.subject).toBe('Ksage test email');
    expect(mail.text).toContain('Ksage can send mail');
    expect(mail.text).toContain('while Email is switched on');
  });
});

describe('the notification mails (LAI-1313)', () => {
  /** What a person might type into a title, a comment or a name. */
  const HOSTILE = '<b>"x"</b>';
  const ESCAPED = '&lt;b&gt;&quot;x&quot;&lt;/b&gt;';
  const hostileTask: TaskRef = { ...TASK, title: HOSTILE, projectName: HOSTILE };

  it('escapes a title, a project and a name in the assignment mail', () => {
    const mail = assignmentEmail({ brand, actorName: HOSTILE, task: hostileTask, prefsUrl: PREFS });
    expect(mail.html).not.toContain(HOSTILE);
    expect(mail.html).toContain(`in ${ESCAPED}: ${ESCAPED}`);
    expect(mail.html).toContain(`${ESCAPED} assigned you`);
  });

  it('escapes the excerpt it quotes in the mention mail', () => {
    const mail = mentionEmail({
      brand,
      actorName: 'Pawan',
      task: hostileTask,
      excerpt: `${HOSTILE} and <img src=x onerror=alert(1)>`,
      prefsUrl: PREFS,
    });
    expect(mail.html).not.toContain(HOSTILE);
    expect(mail.html).not.toContain('<img');
    expect(mail.html).toContain(`${ESCAPED} and &lt;img src=x onerror=alert(1)&gt;`);
  });

  it('escapes every title, line and notice in the digest', () => {
    const mail = digestEmail({
      brand,
      userName: HOSTILE,
      tasks: [{ task: hostileTask, lines: [`${HOSTILE} commented`] }],
      notices: [`${HOSTILE} revoked your token`],
      prefsUrl: PREFS,
    });
    expect(mail.html).not.toContain(HOSTILE);
    expect(mail.html).toContain(`LAI-7: ${ESCAPED}`);
    expect(mail.html).toContain(`<li>${ESCAPED} commented</li>`);
    expect(mail.html).toContain(`<li>${ESCAPED} revoked your token</li>`);
  });

  it('links the reader’s own profile to change what they are mailed, or names it without a public URL', () => {
    const linked = assignmentEmail({ brand, actorName: 'Pawan', task: TASK, prefsUrl: PREFS });
    expect(linked.text).toContain(`Change what Ksage emails you: ${PREFS}`);
    expect(linked.html).toContain(`<a href="${PREFS}"`);
    expect(linked.html).toContain('>Change what Ksage emails you</a>');

    const unlinked = mentionEmail({
      brand,
      actorName: 'Pawan',
      task: { ...TASK, url: null },
      excerpt: 'Look',
      prefsUrl: null,
    });
    expect(unlinked.text).toContain('Change what Ksage emails you on your profile.');
    expect(unlinked.html).not.toContain('<a ');
  });

  it('puts no list inside a paragraph, and says since the last digest, not yesterday', () => {
    const mail = digestEmail({
      brand,
      userName: 'Ada',
      tasks: [{ task: TASK, lines: ['Pawan commented', 'Pawan moved it to Done'] }],
      notices: ['Pawan revoked your token laptop'],
      prefsUrl: PREFS,
    });
    const paragraphs = mail.html.match(/<p\b[^>]*>[\s\S]*?<\/p>/g) ?? [];
    expect(paragraphs.length).toBeGreaterThan(0);
    for (const p of paragraphs) expect(p).not.toMatch(/<ul|<li/);
    expect(mail.html.match(/<ul/g)).toHaveLength(2);
    expect(mail.text).toContain('since your last digest');
    expect(mail.html).toContain('since your last digest');
    expect(mail.text).not.toContain('yesterday');
    expect(mail.html).not.toContain('yesterday');
  });
});

describe('the small helpers', () => {
  it('escapes the five characters that matter in text and attributes', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('says a duration in hours under two days, in days after, and never zero', () => {
    expect(validFor(NOW + 24 * HOUR, NOW)).toBe('24 hours');
    expect(validFor(NOW + HOUR, NOW)).toBe('1 hour');
    expect(validFor(NOW, NOW)).toBe('1 hour');
    expect(validFor(NOW + 3 * 24 * HOUR, NOW)).toBe('3 days');
  });
});
