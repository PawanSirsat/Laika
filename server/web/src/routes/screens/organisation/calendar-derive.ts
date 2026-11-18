import type {
  CalendarRuleInput,
  CalendarRuleKind,
  CalendarSource,
  CalendarSourceInput,
  CalendarSyncResult,
  CalendarTest,
} from '../../../api/calendar.ts';

/**
 * The words and the form the Organisation screen's *Outlook calendar* card
 * draws from LAI-1316's answers (D-157). Pure, so every sentence and every
 * rule of the form is tested without a browser; the component only lays them
 * out.
 */

/** The role an app needs to read everyone's calendars, as Microsoft names it. */
export const CALENDARS_READ = 'Calendars.Read';

/** The most rules the server keeps. */
export const MAX_RULES = 50;

/** The longest rule text the server keeps. */
export const MAX_RULE_TEXT = 120;

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A verified domain, as Entra also accepts in place of the tenant's GUID. */
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

/** An Entra id: the app's client id, or a tenant's. */
export function isGuid(value: string): boolean {
  return GUID.test(value.trim());
}

/** A tenant: its GUID, or a domain such as `contoso.onmicrosoft.com`. */
export function isTenant(value: string): boolean {
  const v = value.trim();
  return GUID.test(v) || DOMAIN.test(v);
}

/** One rule as the form holds it while it is typed: `project` is a slug, `''` until picked. */
export interface RuleRow {
  readonly kind: CalendarRuleKind;
  readonly text: string;
  readonly project: string;
}

/**
 * The form: what was saved, until the owner changes it. The secret is never
 * pre-filled. The switch is not in it: it saves the moment it is flipped.
 */
export interface CalendarForm {
  readonly tenantId: string;
  readonly clientId: string;
  /** Typed, never served: blank keeps the saved one. */
  readonly secret: string;
  readonly rules: readonly RuleRow[];
}

/** The form as the view has it. A rule whose space is gone keeps its words and loses its space. */
export function formOf(view: CalendarSource): CalendarForm {
  return {
    tenantId: view.tenant_id ?? '',
    clientId: view.client_id ?? '',
    secret: '',
    rules: view.rules.map((r) => ({
      kind: r.kind,
      text: r.text,
      project: r.project?.slug ?? '',
    })),
  };
}

/** A new, empty rule: a title keyword, as the commoner of the two. */
export function blankRule(): RuleRow {
  return { kind: 'title', text: '', project: '' };
}

/** Each field the form would be refused for, in words, before it is sent. */
export interface FormProblems {
  readonly tenantId?: string;
  readonly clientId?: string;
  readonly secret?: string;
  /** By the rule's place in the list. */
  readonly rules: Readonly<Record<number, string>>;
}

/**
 * What is wrong with the form, field by field — the server's own refusals,
 * said before it is asked: a tenant that is no GUID or domain, a client id
 * that is no GUID, no secret when none is saved, and a rule with no words or
 * no space. A rule left wholly blank is not a problem: it is dropped.
 */
export function problemsOf(form: CalendarForm, view: CalendarSource): FormProblems {
  const rules: Record<number, string> = {};
  form.rules.forEach((r, i) => {
    const text = r.text.trim();
    if (text === '' && r.project === '') return;
    if (text === '') rules[i] = 'Type the words to match.';
    else if (text.length > MAX_RULE_TEXT) rules[i] = `At most ${String(MAX_RULE_TEXT)} characters.`;
    else if (r.project === '') rules[i] = 'Pick the space it goes to.';
  });
  return {
    ...(isTenant(form.tenantId)
      ? {}
      : {
          tenantId:
            form.tenantId.trim() === ''
              ? 'The directory (tenant) ID is needed.'
              : 'Use the directory (tenant) ID, or a domain such as contoso.onmicrosoft.com.',
        }),
    ...(isGuid(form.clientId)
      ? {}
      : {
          clientId:
            form.clientId.trim() === ''
              ? 'The application (client) ID is needed.'
              : 'Use the application (client) ID: a GUID.',
        }),
    ...(form.secret.trim() === '' && view.secret_last4 === null
      ? { secret: 'Paste the client secret.' }
      : {}),
    rules,
  };
}

/** Whether a problems answer has any problem in it. */
export function hasProblems(problems: FormProblems): boolean {
  return (
    problems.tenantId !== undefined ||
    problems.clientId !== undefined ||
    problems.secret !== undefined ||
    Object.keys(problems.rules).length > 0
  );
}

/** The rules as `PUT` takes them: trimmed, the blank ones dropped. */
export function rulesInput(rows: readonly RuleRow[]): readonly CalendarRuleInput[] {
  return rows
    .map((r) => ({ kind: r.kind, text: r.text.trim(), project: r.project }))
    .filter((r) => r.text !== '' || r.project !== '');
}

/** The body of `PUT /org/calendar`: the secret only when one was typed. */
export function inputOf(form: CalendarForm, enabled: boolean): CalendarSourceInput {
  const secret = form.secret.trim();
  return {
    tenant_id: form.tenantId.trim(),
    client_id: form.clientId.trim(),
    ...(secret === '' ? {} : { client_secret: secret }),
    enabled,
    rules: rulesInput(form.rules),
  };
}

/**
 * The body that flips the switch: everything as saved, the switch as asked.
 * A rule whose space is gone sends nothing anywhere already, and the server
 * would refuse its empty space, so it is left out.
 */
export function switchInput(view: CalendarSource, enabled: boolean): CalendarSourceInput {
  return {
    tenant_id: view.tenant_id ?? '',
    client_id: view.client_id ?? '',
    enabled,
    rules: view.rules.flatMap((r) =>
      r.project === null ? [] : [{ kind: r.kind, text: r.text, project: r.project.slug }],
    ),
  };
}

/** Whether the form says anything the saved view does not. */
export function formChanged(form: CalendarForm, view: CalendarSource): boolean {
  const saved = formOf(view);
  if (form.secret.trim() !== '') return true;
  if (form.tenantId.trim() !== saved.tenantId) return true;
  if (form.clientId.trim() !== saved.clientId) return true;
  const a = rulesInput(form.rules);
  const b = rulesInput(saved.rules);
  return (
    a.length !== b.length ||
    a.some((r, i) => {
      const s = b[i];
      return r.kind !== s?.kind || r.text !== s.text || r.project !== s.project;
    })
  );
}

/** `1 meeting`, `2 meetings`. */
function count(n: number, one: string, many: string): string {
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * The last sync's counts, in one line: what it read and what it did. A part
 * that is nought is left out, but the meetings are always said — *0
 * meetings* is an answer.
 */
export function countsLine(result: CalendarSyncResult): string {
  const did = [
    result.created > 0 ? `${String(result.created)} logged` : '',
    result.updated > 0 ? `${String(result.updated)} updated` : '',
    result.removed > 0 ? `${String(result.removed)} removed` : '',
    result.kept_edits > 0 ? `${String(result.kept_edits)} left as people changed them` : '',
    result.skipped > 0 ? `${String(result.skipped)} held back (day full or closed)` : '',
    result.not_a_meeting > 0
      ? `${String(result.not_a_meeting)} of people’s own events left off (not Teams meetings)`
      : '',
  ].filter((part) => part !== '');
  // The people skipped, by reason (LAI-1316 review F1): each is one person
  // not read, never the run failing.
  const notRead = [
    result.no_mailbox > 0 ? `${String(result.no_mailbox)} with no Outlook calendar` : '',
    result.mailbox_denied > 0
      ? `${String(result.mailbox_denied)} whose calendar Microsoft would not open`
      : '',
    result.mailbox_refused > 0
      ? `${String(result.mailbox_refused)} Microsoft could not look up`
      : '',
  ].filter((part) => part !== '');
  const people = [count(result.people, 'person', 'people'), ...notRead].join(', ');
  return [count(result.meetings, 'meeting', 'meetings'), ...did, people].join(' · ');
}

/** The roles a test found, A–Z, as one line; `none` when the token carries none. */
export function rolesLine(test: CalendarTest): string {
  return test.roles.length === 0 ? 'none' : [...test.roles].sort().join(', ');
}

/** The test's verdict, in words. */
export function testVerdict(test: CalendarTest): string {
  return test.calendars_read
    ? `Connected. Microsoft grants ${CALENDARS_READ}.`
    : `Connected, but Microsoft does not grant ${CALENDARS_READ} yet.`;
}

/** What to do when the permission is missing — the one step only an Entra admin can take. */
export const GRANT_STEP = `An Entra admin grants the app the Microsoft Graph application permission ${CALENDARS_READ} (API permissions → Add a permission → Microsoft Graph → Application permissions), then clicks “Grant admin consent”. Test again afterwards.`;

/** The card head's chip. */
export function statusWord(view: CalendarSource): 'not set up' | 'off' | 'on' {
  if (!view.configured) return 'not set up';
  return view.enabled ? 'on' : 'off';
}
