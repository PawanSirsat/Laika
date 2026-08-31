/**
 * What the context document is for, in SPEC §7.3's own terms.
 *
 * The empty state is this screen's whole job. A blank textarea labelled
 * "Context" teaches nobody what to write, and the document's value depends
 * entirely on someone writing the right things in it — §7.3 exists because the
 * alternative is every teammate keeping a private `NOTES.md` and re-explaining
 * the same architecture to their own agent, differently.
 *
 * The two lists are kept here rather than inline in the component so a test can
 * hold them against `docs/SPEC.md`. Copy that drifts from the spec it claims to
 * quote is worse than copy that never claimed to.
 */

/** §7.3 "What belongs in it". */
export const CONTEXT_BELONGS: readonly string[] = [
  'architecture and conventions a new session must know',
  'decisions already made and closed',
  'glossary and domain terms',
  'things deliberately not done and why',
];

/** §7.3 "What does not", each with the reason the spec gives. */
export const CONTEXT_EXCLUDED: readonly { readonly what: string; readonly why: string }[] = [
  { what: 'anything task-specific', why: 'that is the task body' },
  { what: 'anything secret', why: "it is served to every project member's agent" },
  { what: 'anything that changes per-session', why: 'the document is read once per session' },
];

/**
 * One line saying what the document *is*, before either list.
 *
 * "Served to every agent session" is the part that changes how someone writes:
 * it is not a private note, and it is not documentation for humans to browse.
 */
export const CONTEXT_PURPOSE =
  'One markdown document per project, served to every agent session on it. Write it once instead of re-explaining the same architecture to each teammate’s agent.';
