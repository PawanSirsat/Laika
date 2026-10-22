import type { MentionCandidate } from './LazyRichEditor.tsx';

/**
 * Which `@name` in a text names somebody, and how its pill looks (LAI-868).
 *
 * The reading view (`TaskMarkdown`) and the rich editor's decoration both ask
 * this module, so a mention looks the same before and after a click.
 *
 * ## One grammar, the server's
 *
 * {@link MENTION_PATTERN} is `parseMentionHandles`'s pattern
 * (`server/src/services/mentions.ts`), character for character, and
 * `test/routes/screens/task/mentions.test.ts` reads that file to keep it so. A
 * pill covers exactly what the pattern matches: the `@` and the handle, never
 * the `.` that ends a sentence. `ada@example.com` is an address, not a pill.
 *
 * ## Who gets one
 *
 * A handle is the email's local part, case-insensitively (SPEC §4.19). It gets
 * a pill only when **exactly one** person in the panel's people list holds it.
 * Two holders is the ambiguous case §4.19 resolves to nobody, so it stays plain
 * text, as nobody does. `@strelka` and `@belka`, the two machines (D-097), are
 * not users: held by nobody, they get the machine pill; held by a person, they
 * are that person's.
 *
 * The people list is what `/mentionable` offers, so a handle held by somebody
 * outside it — another domain, a deactivated account — can show a pill the
 * server would not resolve. LAI-839 will send the server's own handle.
 *
 * ## Nothing here changes the text
 *
 * A pill is a styled range over characters already there. The stored Markdown
 * and what the reader can copy are the characters that were written.
 */

/**
 * `parseMentionHandles`'s pattern. Group 1 is the handle; the whole match is
 * the pill. Global, so copy it before a loop of `exec`, as
 * {@link findMentions} does.
 */
export const MENTION_PATTERN =
  /(?<![A-Za-z0-9_@.+%-])@([A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9])?)/g;

/** The machines' handles (D-097): not users, so their pill is the softer one. */
export const MACHINE_HANDLES: readonly string[] = ['strelka', 'belka'];

/** `me` the viewer, `person` anyone else, `machine` `@strelka` or `@belka`. */
export type MentionKind = 'me' | 'person' | 'machine';

/** What decides a pill: the panel's people list and who is reading. */
export interface MentionDirectory {
  readonly people: readonly MentionCandidate[];
  readonly meId?: string | undefined;
}

/** One `@handle` in a text: `[start, end)` is the pill, `handle` without the `@`. */
export interface MentionMatch {
  readonly start: number;
  readonly end: number;
  readonly handle: string;
}

/** Every grammar match in `text`, in order. */
export function findMentions(text: string): MentionMatch[] {
  const found: MentionMatch[] = [];
  for (const match of text.matchAll(new RegExp(MENTION_PATTERN))) {
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      handle: match[1] ?? '',
    });
  }
  return found;
}

/** The pill `handle` gets, or `null` for plain text. */
export function mentionKind(handle: string, directory: MentionDirectory): MentionKind | null {
  const wanted = handle.toLowerCase();
  const holders = directory.people.filter((p) => p.handle?.toLowerCase() === wanted);
  if (holders.length === 1) return holders[0]?.id === directory.meId ? 'me' : 'person';
  if (holders.length === 0 && MACHINE_HANDLES.includes(wanted)) return 'machine';
  return null;
}

/** The pill's classes, shared by the reading view and the editor. */
export function mentionClass(kind: MentionKind): string {
  return `md-mention md-mention-${kind}`;
}
