/**
 * What a paste into the task editor keeps (LAI-827): **text, lists, links and
 * tables, and nothing else.**
 *
 * Copying from Jira, a Google Doc or a web page puts HTML on the clipboard,
 * with styles, images, scripts, tracking pixels and whatever markup the source
 * uses. The editor reduces it before ProseMirror reads it: an allowed element
 * is rebuilt bare, a block becomes a paragraph, any other element gives up its
 * words and nothing else, and a few are dropped whole with their contents.
 *
 * **The HTML is never live.** It is parsed by `DOMParser`, whose document has
 * no browsing context: nothing in it runs, and nothing in it is fetched — no
 * `<script>`, no `onerror`, no `<img src>`. Only the rebuilt string leaves this
 * file, and ProseMirror parses that into a detached document of its own.
 */

/** Rebuilt as themselves, with these attributes only. */
const KEPT: Readonly<Record<string, readonly string[]>> = {
  p: [],
  br: [],
  ul: [],
  ol: [],
  li: [],
  a: ['href'],
  table: [],
  thead: [],
  tbody: [],
  tfoot: [],
  tr: [],
  th: [],
  td: [],
};

/** Dropped with everything inside them: none of it is text a person meant. */
const DROPPED = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'head',
  'title',
  'meta',
  'link',
  'iframe',
  'frame',
  'object',
  'embed',
  'img',
  'picture',
  'video',
  'audio',
  'source',
  'canvas',
  'svg',
  'math',
  'button',
  'input',
  'select',
  'textarea',
]);

/** Blocks whose words become a paragraph of their own. */
const BLOCKS = new Set([
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'aside',
  'nav',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'figure',
  'figcaption',
  'address',
  'details',
  'summary',
  'dl',
  'dt',
  'dd',
  'hr',
]);

export type TagPolicy = 'keep' | 'drop' | 'block' | 'unwrap';

/** What happens to an element with this tag name. */
export function tagPolicy(tag: string): TagPolicy {
  const name = tag.toLowerCase();
  if (name in KEPT) return 'keep';
  if (DROPPED.has(name)) return 'drop';
  if (BLOCKS.has(name)) return 'block';
  return 'unwrap';
}

/**
 * A pasted link's address, if it may stay a link: an absolute `http(s)` or
 * `mailto:` address. A relative one meant somewhere on the page it came from,
 * not on Laika, and anything else — `javascript:`, `data:` — is not a
 * destination. Either way the words stay; only the link goes.
 */
export function safeHref(href: string | null): string | null {
  if (href === null) return null;
  const trimmed = href.trim();
  return /^(?:https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : null;
}

/** Does this element hold a block of its own somewhere inside? */
function holdsBlock(element: Element): boolean {
  return Array.from(element.querySelectorAll('*')).some((inner) => {
    const policy = tagPolicy(inner.tagName);
    return policy === 'block' || (policy === 'keep' && !['a', 'br'].includes(inner.localName));
  });
}

function reduceInto(from: Node, to: Element, doc: Document, preformatted: boolean): void {
  for (const child of Array.from(from.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? '';
      if (!preformatted) {
        to.append(doc.createTextNode(text));
        continue;
      }
      // A `<pre>`'s lines stay lines, not one run of words.
      text.split('\n').forEach((line, i) => {
        if (i > 0) to.append(doc.createElement('br'));
        to.append(doc.createTextNode(line));
      });
      continue;
    }
    if (!(child instanceof Element)) continue;

    const name = child.localName;
    const policy = tagPolicy(name);
    if (policy === 'drop') continue;

    if (policy === 'keep') {
      if (name === 'a') {
        const href = safeHref(child.getAttribute('href'));
        if (href === null) {
          reduceInto(child, to, doc, preformatted);
          continue;
        }
        const link = doc.createElement('a');
        link.setAttribute('href', href);
        reduceInto(child, link, doc, preformatted);
        to.append(link);
        continue;
      }
      const copy = doc.createElement(name);
      reduceInto(child, copy, doc, preformatted);
      to.append(copy);
      continue;
    }

    if (policy === 'block') {
      const pre = preformatted || name === 'pre';
      if (holdsBlock(child)) {
        reduceInto(child, to, doc, pre);
      } else {
        const paragraph = doc.createElement('p');
        reduceInto(child, paragraph, doc, pre);
        to.append(paragraph);
      }
      continue;
    }

    reduceInto(child, to, doc, preformatted);
  }
}

/** The pasted HTML, reduced to text, lists, links and tables. */
export function reducePastedHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const out = parsed.createElement('div');
  reduceInto(parsed.body, out, parsed, false);
  return out.innerHTML;
}
