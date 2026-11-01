/** One line of a block's text: how far it is indented, and whether it carries the real token. */
export interface CommandLine {
  readonly text: string;
  /** Its leading spaces — where its own text starts, for the hanging indent. */
  readonly lead: number;
  readonly token: boolean;
}

/**
 * A block's text cut into its lines (LAI-742; runs since LAI-740), so each can
 * hang under its own start and the lines holding the real token can be
 * highlighted **without changing the text at all** — joined with `\n` they are
 * the input exactly, which is what the copy button copies and what a selection
 * picks up. Before a mint there is no secret, and nothing is marked: a
 * placeholder is not a token.
 *
 * Moved here from `connect-wizard.ts` by LAI-1044 so `CodeBlock` can use it
 * outside Connect.
 */
export function commandLines(text: string, secret: string | undefined): readonly CommandLine[] {
  const marks = secret !== undefined && secret !== '';
  return text.split('\n').map((line) => ({
    text: line,
    lead: line.length - line.replace(/^ +/, '').length,
    token: marks && line.includes(secret),
  }));
}
