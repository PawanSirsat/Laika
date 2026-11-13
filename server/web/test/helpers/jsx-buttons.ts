/**
 * Reading the buttons out of a `.tsx` source, for the guards that hold
 * icon-only controls to a name and a tooltip (LAI-1209, shared in LAI-1213).
 *
 * Approximate by design — a scanner, not a parser — and tested on the shapes
 * the source actually uses (`dialog-icon-names.test.ts`, "the reader").
 */

/** One element: its opening tag and what it holds. */
export interface Element {
  readonly open: string;
  readonly inner: string;
  /** Offset of the opening tag in the source it was read from. */
  readonly at: number;
}

/** The end of a JSX opening tag starting at `from`, skipping `>` inside `{…}` and strings. */
function tagEnd(src: string, from: number): number {
  let depth = 0;
  let quote: string | undefined;
  let i = from;
  for (; i < src.length; i++) {
    const c = src[i];
    if (quote !== undefined) {
      if (c === quote) quote = undefined;
      continue;
    }
    if (depth > 0 && (c === "'" || c === '"' || c === '`')) quote = c;
    else if (depth === 0 && c === '"') quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') depth -= 1;
    else if (c === '>' && depth === 0) break;
  }
  return i;
}

/** Each `<tag …>…</tag>` of a tag that does not nest inside itself (`button`, `a`). */
export function elements(src: string, tag: string): Element[] {
  const out: Element[] = [];
  const start = new RegExp(`<${tag}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = start.exec(src)) !== null) {
    const i = tagEnd(src, m.index + m[0].length);
    const open = src.slice(m.index, i + 1);
    if (open.endsWith('/>')) {
      out.push({ open, inner: '', at: m.index });
      continue;
    }
    const end = src.indexOf(`</${tag}>`, i);
    out.push({ open, inner: end === -1 ? '' : src.slice(i + 1, end), at: m.index });
  }
  return out;
}

/** Each `<button …>…</button>`. Buttons do not nest. */
export function buttons(src: string): Element[] {
  return elements(src, 'button');
}

/** Each opening tag of a component, e.g. every `<IconButton …/>`. */
export function openTags(src: string, tag: string): Element[] {
  const out: Element[] = [];
  const start = new RegExp(`<${tag}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = start.exec(src)) !== null) {
    const i = tagEnd(src, m.index + m[0].length);
    out.push({ open: src.slice(m.index, i + 1), inner: '', at: m.index });
  }
  return out;
}

/**
 * Whether content has words of its own. Tags are dropped (an `<Icon>` says
 * nothing); an expression is words unless all it holds is a condition guarding
 * a tag (`{busy && <Spinner />}`) — `{label}` or `{children}` may be words,
 * and is given the benefit of the doubt.
 */
export function hasWords(inner: string): boolean {
  let text = inner.replace(/<[^>]*>/g, ' ');
  for (let guard = 0; guard < 10 && /\{[^{}]*\}/.test(text); guard++) {
    text = text.replace(/\{([^{}]*)\}/g, (_, body: string) =>
      body.trim() === '' || /&&\s*$/.test(body.trim()) ? ' ' : ' WORDS ',
    );
  }
  return /[\p{L}\p{N}]/u.test(text);
}

/** Whether an opening tag carries an accessible name. */
export const named = (open: string): boolean => /\baria-label(?:ledby)?=/.test(open);

/** Whether the element at `at` sits directly inside a `<Tooltip …>` (or `<InfoHint>`'s). */
export function insideTooltip(src: string, at: number): boolean {
  const before = src
    .slice(0, at)
    .replace(/\{\s*\}/g, '')
    .trimEnd();
  return /<Tooltip\b[^<]*>$/.test(before);
}
