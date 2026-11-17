import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  inviteEmail,
  resetEmail,
  testEmail,
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
