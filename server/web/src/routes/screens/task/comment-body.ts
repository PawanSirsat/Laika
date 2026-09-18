/**
 * Splitting a comment's body on fenced code (LAI-284).
 *
 * **Pure, and in a `.ts` file on purpose** (CONVENTIONS §4). `node --test` has
 * no JSX loader, so a parser living beside its renderer in a `.tsx` cannot be
 * tested at all — which is how a parser ends up with no tests.
 *
 * The design shows a comment quoting `POST /tasks/…` in a bordered monospace
 * box; ours rendered `body_md` as one flat paragraph, so a pasted request line
 * arrived wrapped into prose.
 *
 * **Fences only, and nothing else.** This is not a markdown renderer and must
 * not become one by accretion: no bold, no links, no lists. A comment body is
 * untrusted text written by anyone who can comment, and every construct added
 * here is a new way for it to do something other than be read. Fenced code is
 * the one the design needs and the one that is unambiguous to parse.
 *
 * Everything is rendered as **text nodes** — React escapes them — so there is
 * no path from a comment to markup.
 */

interface Block {
  readonly kind: 'text' | 'code';
  readonly content: string;
  /** The word after the opening fence, when there is one. */
  readonly language?: string;
}

/**
 * Split on ``` fences.
 *
 * An unclosed fence makes the rest of the comment code, which is what every
 * editor does and what somebody who opened a fence meant. The alternative —
 * discarding the fence and running the code back into the prose — loses the
 * distinction the author was drawing.
 */
export function splitFences(body: string): readonly Block[] {
  const blocks: Block[] = [];
  const lines = body.split('\n');
  let buffer: string[] = [];
  let inCode = false;
  let language: string | undefined;

  const flush = (kind: 'text' | 'code'): void => {
    if (buffer.length === 0) return;
    const content = kind === 'code' ? buffer.join('\n') : buffer.join('\n').trim();
    if (content !== '') {
      blocks.push(
        kind === 'code' && language !== undefined ? { kind, content, language } : { kind, content },
      );
    }
    buffer = [];
  };

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        flush('code');
        inCode = false;
        language = undefined;
      } else {
        flush('text');
        inCode = true;
        const tag = line.trim().slice(3).trim();
        language = tag === '' ? undefined : tag;
      }
      continue;
    }
    buffer.push(line);
  }

  flush(inCode ? 'code' : 'text');
  return blocks;
}
