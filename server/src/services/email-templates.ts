/**
 * The words Laika's emails say (D-153, LAI-1312): plain text first, and a
 * simple HTML twin of it.
 *
 * **No remote images, no tracking, no script.** Nothing in a message fetches
 * anything when it is opened — a self-hosted board that phoned home from an
 * inbox would contradict §13.4. The HTML is inline-styled because mail clients
 * drop `<style>` blocks, and every value in it is escaped: an organisation or
 * a person's name is text somebody typed.
 *
 * **The product is named by the sender.** The From name an admin sets on the
 * Email card (*Ksage* on Kvell's board) is what a recipient knows the board
 * as, so the copy uses it rather than a name baked in here.
 */

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** What every template is told about where the mail comes from. */
export interface EmailBrand {
  /** The From name: what the recipient knows this board as. */
  product: string;
  /** The organisation's name (§4.2). */
  orgName: string;
}

/** `&`, `<`, `>`, `"` and `'` — enough for text in elements and attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * How long a link still works, in words: `24 hours`, `7 days`. Relative on
 * purpose — the server does not know the reader's time zone, and a date in the
 * wrong one is worse than a duration.
 */
export function validFor(expiresAt: number, now: number): string {
  const hours = Math.max(1, Math.round((expiresAt - now) / (60 * 60 * 1000)));
  if (hours < 48) return hours === 1 ? '1 hour' : `${String(hours)} hours`;
  const days = Math.round(hours / 24);
  return `${String(days)} days`;
}

/** The HTML frame every message shares: one column, readable in either theme. */
function frame(brand: EmailBrand, heading: string, paragraphs: string[], button?: Button): string {
  const body = paragraphs
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;">${p}</p>`)
    .join('\n');
  const action =
    button === undefined
      ? ''
      : `<p style="margin:24px 0;"><a href="${escapeHtml(button.url)}" style="display:inline-block;padding:10px 18px;border-radius:6px;background:#2f5bea;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">${escapeHtml(button.label)}</a></p>
<p style="margin:0 0 16px;font-size:13px;line-height:1.5;color:#5b6170;">Or paste this into your browser:<br><span style="word-break:break-all;">${escapeHtml(button.url)}</span></p>`;
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:24px;background:#f6f7f9;color:#1d2230;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e6ec;border-radius:8px;padding:28px;">
<h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;">${escapeHtml(heading)}</h1>
${body}
${action}
<p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#5b6170;">${escapeHtml(brand.product)} · ${escapeHtml(brand.orgName)}</p>
</div>
</body>
</html>
`;
}

interface Button {
  label: string;
  url: string;
}

/** The plain-text footer, under a rule. */
function textFooter(brand: EmailBrand): string {
  return `--\n${brand.product} · ${brand.orgName}\n`;
}

export interface InviteEmailInput {
  brand: EmailBrand;
  /** Who invited them; their name as Laika knows it. */
  inviterName: string;
  acceptUrl: string;
  expiresAt: number;
  now: number;
}

/** An invitation to join the organisation (§4.11). */
export function inviteEmail(input: InviteEmailInput): RenderedEmail {
  const { brand } = input;
  const valid = validFor(input.expiresAt, input.now);
  const subject = `${input.inviterName} invited you to ${brand.orgName} on ${brand.product}`;
  const text = `${input.inviterName} invited you to join ${brand.orgName} on ${brand.product}.

Accept the invitation and set your password here:
${input.acceptUrl}

The link works once, for ${valid}. If you weren't expecting it, you can ignore this email; nothing happens unless the link is used.

${textFooter(brand)}`;
  const html = frame(
    brand,
    `You're invited to ${brand.orgName}`,
    [
      `${escapeHtml(input.inviterName)} invited you to join ${escapeHtml(brand.orgName)} on ${escapeHtml(brand.product)}.`,
      `The link works once, for ${escapeHtml(valid)}. If you weren't expecting it, you can ignore this email; nothing happens unless the link is used.`,
    ],
    { label: 'Accept the invitation', url: input.acceptUrl },
  );
  return { subject, text, html };
}

export interface ResetEmailInput {
  brand: EmailBrand;
  /** The person whose password it resets. */
  userName: string;
  /** The owner or admin who issued the link (§4.60). */
  issuerName: string;
  resetUrl: string;
  expiresAt: number;
  now: number;
}

/** A password-reset link an admin issued (§4.60). */
export function resetEmail(input: ResetEmailInput): RenderedEmail {
  const { brand } = input;
  const valid = validFor(input.expiresAt, input.now);
  const subject = `Set a new password for ${brand.product}`;
  const text = `Hi ${input.userName},

${input.issuerName} issued a link for you to set a new password on ${brand.product}:
${input.resetUrl}

It works once, for ${valid}, and any earlier link stops working. If you didn't ask for this, tell ${input.issuerName}; your password stays as it is unless the link is used.

${textFooter(brand)}`;
  const html = frame(
    brand,
    'Set a new password',
    [
      `Hi ${escapeHtml(input.userName)},`,
      `${escapeHtml(input.issuerName)} issued a link for you to set a new password on ${escapeHtml(brand.product)}.`,
      `It works once, for ${escapeHtml(valid)}, and any earlier link stops working. If you didn't ask for this, tell ${escapeHtml(input.issuerName)}; your password stays as it is unless the link is used.`,
    ],
    { label: 'Set a new password', url: input.resetUrl },
  );
  return { subject, text, html };
}

export interface TestEmailInput {
  brand: EmailBrand;
  /** Who pressed *Send test email*: the message goes to them. */
  userName: string;
}

/** What *Send test email* sends: proof the settings work, and nothing else. */
export function testEmail(input: TestEmailInput): RenderedEmail {
  const { brand } = input;
  const subject = `${brand.product} test email`;
  const text = `Hi ${input.userName},

This is the test email you sent from ${brand.orgName}'s Email settings. If you can read it, ${brand.product} can send mail.

Mail only goes out while Email is switched on in Organisation > Integrations.

${textFooter(brand)}`;
  const html = frame(brand, 'Test email', [
    `Hi ${escapeHtml(input.userName)},`,
    `This is the test email you sent from ${escapeHtml(brand.orgName)}'s Email settings. If you can read it, ${escapeHtml(brand.product)} can send mail.`,
    `Mail only goes out while Email is switched on in Organisation › Integrations.`,
  ]);
  return { subject, text, html };
}
