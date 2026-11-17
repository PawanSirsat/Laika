/**
 * A document's outline, and the anchors its headings carry (LAI-1131).
 *
 * Two paths produce heading ids and they must agree: {@link extractOutline}
 * reads the Markdown **source** (for the outline and the compare view, which
 * never render), and {@link headingIds} is the rehype step that stamps ids on
 * the **rendered** headings. Both run the same {@link Slugger} over the same
 * heading text in the same order, and `outline.test.ts` renders every trial
 * fixture to prove the two lists are identical.
 *
 * Ids are `h-<slug>` (deliverable-engine.md §2.3 T2): the prefix keeps a
 * heading called "main" or "footnotes" from colliding with an id the app or
 * the footnote block already uses.
 */

export interface OutlineEntry {
  /** 1–6, as the heading's `#` count. */
  readonly depth: number;
  /** The heading's words, Markdown stripped. */
  readonly text: string;
  /** The anchor, `h-<slug>`, unique within the document. */
  readonly id: string;
}

/** Lower-case, words joined by `-`, nothing else. Never empty. */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'section' : slug;
}

/**
 * Hands out unique slugs in order: the second "Set-up" is `set-up-2`, the
 * third `set-up-3`, and a heading literally titled "Set-up 2" does not steal
 * a number the counter later hands out — every slug handed out is remembered.
 */
export class Slugger {
  private readonly seen = new Set<string>();

  slug(text: string): string {
    const base = slugify(text);
    let candidate = base;
    for (let n = 2; this.seen.has(candidate); n++) candidate = `${base}-${String(n)}`;
    this.seen.add(candidate);
    return candidate;
  }
}

/** The prefix every heading id carries. */
export const HEADING_PREFIX = 'h-';

/**
 * Inline Markdown to its words: emphasis, code spans, links (keeping their
 * text), images (keeping their alt) and escapes. Enough for headings, which
 * is all this is used for.
 */
export function plainHeadingText(markdown: string): string {
  return markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1')
    .replace(/\s+#+\s*$/, '')
    .trim();
}

/**
 * Every ATX heading (`#` … `######`) outside fenced code, in order, with the
 * id the renderer will give it. Setext headings are not used by the trial
 * fixtures and are not read.
 */
export function extractOutline(markdown: string): OutlineEntry[] {
  const slugger = new Slugger();
  const out: OutlineEntry[] = [];
  let fence: string | null = null;
  for (const line of markdown.split('\n')) {
    const opener = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (opener?.[1] !== undefined) {
      const mark = opener[1];
      if (fence === null) fence = mark;
      else if (mark.startsWith(fence.charAt(0)) && mark.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = /^ {0,3}(#{1,6})\s+(.*)$/.exec(line);
    if (heading?.[1] === undefined || heading[2] === undefined) continue;
    const text = plainHeadingText(heading[2]);
    out.push({ depth: heading[1].length, text, id: HEADING_PREFIX + slugger.slug(text) });
  }
  return out;
}

/* ---- the rendered side ---- */

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

const HEADING = /^h[1-6]$/;

/**
 * The rehype step: an `id` on every heading the source wrote, from the same
 * {@link Slugger}. A heading that already has an id is not the author's — the
 * footnote block's "Footnotes" label is the one case — and is left alone, as
 * {@link extractOutline} never saw it either.
 *
 * It sets one property and creates, removes or retags nothing.
 */
export function headingIds() {
  return (tree: HastNode): void => {
    const slugger = new Slugger();
    const walk = (node: HastNode): void => {
      if (node.type === 'element' && HEADING.test(node.tagName ?? '')) {
        const props = (node.properties ??= {});
        if (props.id === undefined) {
          props.id = HEADING_PREFIX + slugger.slug(plainHeadingText(textOf(node)));
        }
        return;
      }
      for (const kid of node.children ?? []) walk(kid);
    };
    walk(tree);
  };
}

/**
 * The outline as a tree for the sidebar: each entry with the deeper entries
 * that follow it until the next at its depth or shallower.
 */
export interface OutlineNode extends OutlineEntry {
  readonly children: OutlineNode[];
}

export function outlineTree(entries: readonly OutlineEntry[], maxDepth = 3): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: OutlineNode[] = [];
  for (const entry of entries) {
    if (entry.depth > maxDepth) continue;
    const node: OutlineNode = { ...entry, children: [] };
    while (stack.length > 0 && (stack[stack.length - 1]?.depth ?? 0) >= entry.depth) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent === undefined) roots.push(node);
    else parent.children.push(node);
    stack.push(node);
  }
  return roots;
}
