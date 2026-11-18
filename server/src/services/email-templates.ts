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

/**
 * One piece of a message's body, already escaped: a string is a paragraph; a
 * `block` is markup that may not sit inside one — a list — and goes in a
 * `<div>` of the same spacing instead.
 */
type Part = string | { block: string };

/** The HTML frame every message shares: one column, readable in either theme. */
function frame(brand: EmailBrand, heading: string, parts: Part[], button?: Button): string {
  const body = parts
    .map((p) =>
      typeof p === 'string'
        ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;">${p}</p>`
        : `<div style="margin:0 0 16px;font-size:15px;line-height:1.5;">${p.block}</div>`,
    )
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

/** A task as a mail names it: its key, title and, when the board has a public URL, a link. */
export interface TaskRef {
  key: string;
  title: string;
  projectName: string;
  /** `LAIKA_PUBLIC_URL/task/<key>`, or null when the server has no public URL. */
  url: string | null;
}

/** `LAI-42: Title` — the way a person names a task out loud. */
function taskLine(task: TaskRef): string {
  return `${task.key}: ${task.title}`;
}

/**
 * Why they got it, and where to change it (CHIEF's LAI-1313 review): every
 * notification mail links the reader's own profile, where their two switches
 * are. Without a public URL there is no link to give, so it says where.
 */
function why(
  brand: EmailBrand,
  reason: string,
  prefsUrl: string | null,
): { text: string; html: string } {
  const change = `Change what ${brand.product} emails you`;
  return prefsUrl === null
    ? {
        text: `${reason} ${change} on your profile.`,
        html: `${escapeHtml(reason)} ${escapeHtml(change)} on your profile.`,
      }
    : {
        text: `${reason} ${change}: ${prefsUrl}`,
        html: `${escapeHtml(reason)} <a href="${escapeHtml(prefsUrl)}" style="color:#2f5bea;">${escapeHtml(change)}</a>.`,
      };
}

export interface AssignmentEmailInput {
  brand: EmailBrand;
  /** Who assigned it. */
  actorName: string;
  task: TaskRef;
  /** The reader's own profile, where they change what they are mailed; null without a public URL. */
  prefsUrl: string | null;
}

/** You were assigned a task (D-153, LAI-1313) — instant. */
export function assignmentEmail(input: AssignmentEmailInput): RenderedEmail {
  const { brand, task } = input;
  const subject = `${input.actorName} assigned you ${taskLine(task)}`;
  const link = task.url === null ? '' : `\nOpen it: ${task.url}\n`;
  const footer = why(brand, "You're getting this because it's assigned to you.", input.prefsUrl);
  const text = `${input.actorName} assigned you ${task.key} in ${task.projectName}:
${task.title}
${link}
${footer.text}

${textFooter(brand)}`;
  const html = frame(
    brand,
    `${task.key} is yours`,
    [
      `${escapeHtml(input.actorName)} assigned you <strong>${escapeHtml(task.key)}</strong> in ${escapeHtml(task.projectName)}: ${escapeHtml(task.title)}`,
      footer.html,
    ],
    task.url === null ? undefined : { label: `Open ${task.key}`, url: task.url },
  );
  return { subject, text, html };
}

export interface MentionEmailInput {
  brand: EmailBrand;
  /** Who wrote the comment. */
  actorName: string;
  task: TaskRef;
  /** The comment as plain text, already cut short. */
  excerpt: string;
  /** The reader's own profile, where they change what they are mailed; null without a public URL. */
  prefsUrl: string | null;
}

/** You were @mentioned in a comment (D-153, LAI-1313) — instant. */
export function mentionEmail(input: MentionEmailInput): RenderedEmail {
  const { brand, task } = input;
  const subject = `${input.actorName} mentioned you on ${taskLine(task)}`;
  const link = task.url === null ? '' : `\nReply on the task: ${task.url}\n`;
  const quoted = input.excerpt
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  const footer = why(brand, "You're getting this because you were @mentioned.", input.prefsUrl);
  const text = `${input.actorName} mentioned you on ${task.key} in ${task.projectName} (${task.title}):

${quoted}
${link}
${footer.text}

${textFooter(brand)}`;
  const html = frame(
    brand,
    `${input.actorName} mentioned you`,
    [
      `On <strong>${escapeHtml(task.key)}</strong> in ${escapeHtml(task.projectName)}: ${escapeHtml(task.title)}`,
      `<span style="display:block;border-left:3px solid #d5d9e2;padding-left:12px;color:#3a4050;white-space:pre-wrap;">${escapeHtml(input.excerpt)}</span>`,
      footer.html,
    ],
    task.url === null ? undefined : { label: 'Reply on the task', url: task.url },
  );
  return { subject, text, html };
}

/** One task's part of a digest: what happened on it, in order. */
export interface DigestTask {
  task: TaskRef;
  lines: string[];
}

export interface DigestEmailInput {
  brand: EmailBrand;
  userName: string;
  tasks: DigestTask[];
  /** Member notices, already worded. */
  notices: string[];
  /** The reader's own profile, where they change what they are mailed; null without a public URL. */
  prefsUrl: string | null;
}

/** What happened on the tasks a person watches since their last digest (D-153, LAI-1313) — daily. */
export function digestEmail(input: DigestEmailInput): RenderedEmail {
  const { brand } = input;
  const count = input.tasks.reduce((n, t) => n + t.lines.length, 0) + input.notices.length;
  const subject = `Your ${brand.product} digest: ${String(count)} update${count === 1 ? '' : 's'}`;

  const textTasks = input.tasks
    .map((t) => {
      const head = t.task.url === null ? taskLine(t.task) : `${taskLine(t.task)} — ${t.task.url}`;
      return `${head}\n${t.lines.map((l) => `  - ${l}`).join('\n')}`;
    })
    .join('\n\n');
  const textNotices =
    input.notices.length === 0
      ? ''
      : `\n\nFor you:\n${input.notices.map((l) => `  - ${l}`).join('\n')}`;
  const footer = why(
    brand,
    "You're getting this daily digest because it's on in your profile.",
    input.prefsUrl,
  );
  const text = `Hi ${input.userName},

Here is what happened on the tasks you watch since your last digest.

${textTasks}${textNotices}

${footer.text}

${textFooter(brand)}`;

  const htmlTasks = input.tasks.map((t) => {
    const title =
      t.task.url === null
        ? `<strong>${escapeHtml(taskLine(t.task))}</strong>`
        : `<a href="${escapeHtml(t.task.url)}" style="color:#2f5bea;text-decoration:none;"><strong>${escapeHtml(taskLine(t.task))}</strong></a>`;
    const items = t.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('');
    return { block: `${title}<ul style="margin:6px 0 0;padding-left:20px;">${items}</ul>` };
  });
  const htmlNotices =
    input.notices.length === 0
      ? []
      : [
          {
            block: `<strong>For you</strong><ul style="margin:6px 0 0;padding-left:20px;">${input.notices.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`,
          },
        ];
  const html = frame(brand, 'Your daily digest', [
    `Hi ${escapeHtml(input.userName)}, here is what happened on the tasks you watch since your last digest.`,
    ...htmlTasks,
    ...htmlNotices,
    footer.html,
  ]);
  return { subject, text, html };
}
