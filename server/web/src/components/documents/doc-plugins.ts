/**
 * The document renderer's own tree steps (LAI-1131). Like TaskMarkdown's,
 * they are owned here and never accepted from a caller, and none of them
 * reads or creates raw HTML: each sets a property, adds a text-only element,
 * or trims a marker from a text node.
 */

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

export const CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

const MARKER = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*\n?/i;

function firstElement(node: HastNode): HastNode | undefined {
  return node.children?.find((k) => k.type === 'element');
}

/**
 * GitHub's alert syntax, `> [!NOTE]`, as a callout: the blockquote gets
 * `data-callout="note"` and loses the marker text. A blockquote without the
 * marker is left exactly as it was.
 */
export function callouts() {
  const walk = (node: HastNode): void => {
    for (const kid of node.children ?? []) {
      if (kid.type === 'element' && kid.tagName === 'blockquote') {
        const para = firstElement(kid);
        const text = para?.tagName === 'p' ? para.children?.[0] : undefined;
        const match = text?.type === 'text' ? MARKER.exec(text.value ?? '') : null;
        if (match?.[1] !== undefined && text !== undefined && para !== undefined) {
          (kid.properties ??= {}).dataCallout = match[1].toLowerCase();
          text.value = (text.value ?? '').slice(match[0].length);
          // A marker alone on its line leaves a `<br>`-less empty start; drop
          // an empty first text so the paragraph does not open with a gap.
          if (text.value === '') para.children?.shift();
        }
      }
      walk(kid);
    }
  };
  return walk;
}

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/** Columns in a table's header row. */
function columns(table: HastNode): number {
  const thead = table.children?.find((k) => k.tagName === 'thead');
  const row = thead?.children?.find((k) => k.tagName === 'tr');
  return row?.children?.filter((k) => k.tagName === 'th').length ?? 0;
}

/**
 * Every table gets a `<caption>`: "Table n · <the heading it sits under>".
 * GFM has no caption syntax, and a screen reader's table list is useless
 * when every entry is "table". The column count goes on as `data-columns`
 * so the stylesheet can pin the first column of a wide one.
 */
export function tableCaptions() {
  return (tree: HastNode): void => {
    let heading = '';
    let n = 0;
    const walk = (node: HastNode): void => {
      for (const kid of node.children ?? []) {
        if (kid.type !== 'element') continue;
        if (/^h[1-6]$/.test(kid.tagName ?? '')) {
          heading = textOf(kid).trim();
          continue;
        }
        if (kid.tagName === 'table') {
          n++;
          const label = heading === '' ? `Table ${String(n)}` : `Table ${String(n)} · ${heading}`;
          (kid.properties ??= {}).dataColumns = String(columns(kid));
          kid.children = [
            {
              type: 'element',
              tagName: 'caption',
              properties: {},
              children: [{ type: 'text', value: label }],
            },
            ...(kid.children ?? []),
          ];
          continue;
        }
        walk(kid);
      }
    };
    walk(tree);
  };
}
