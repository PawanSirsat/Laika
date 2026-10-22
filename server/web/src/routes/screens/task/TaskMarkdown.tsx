import { createContext, useContext, useMemo, type ReactNode } from 'react';
import Markdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MentionCandidate } from './LazyRichEditor.tsx';
import { findMentions, mentionClass, mentionKind, type MentionDirectory } from './mentions.ts';
import './task-markdown.css';

/**
 * A task's description and acceptance, rendered (LAI-709).
 *
 * The owner, on ONR-331: *"* showing as it is, that must look properly render
 * like the header and all"*. The fields are called `description_md` for a
 * reason: people and agents write them in markdown, and printed raw, an HLD
 * with headings, tables and code is a wall of asterisks.
 *
 * ## Why this is safe for text anyone on the project can write
 *
 * - `react-markdown` builds **React elements**, never an HTML string, so
 *   nothing reaches `innerHTML`.
 * - **Raw HTML is not rendered.** That takes `rehype-raw`, which is not
 *   installed and must not be. A `<script>` in a description arrives as text.
 * - Every URL goes through `defaultUrlTransform`, which empties `javascript:`,
 *   `data:` and other non-web schemes.
 * - **Images are not loaded.** A self-hosted board makes no third-party
 *   requests (SPEC §13.4), and an image URL in a description is exactly that.
 *   The alt text stands in for it.
 *
 * Comments use it too (LAI-734), through `CommentBody`, which adds a class
 * and a `pre` of its own. A caller can add elements but never replace the
 * three above: they are merged last, so the safety rules hold on every surface.
 *
 * **A caller cannot pass a tree transform.** A rehype plugin runs before
 * react-markdown escapes raw HTML and before the components map, so an
 * open-ended plugin prop could turn raw HTML back into elements or retag an
 * `img` past the rule above. The transforms a surface needs are owned here:
 * one switched on by a boolean, and the mention pills (LAI-868), which take
 * the people list as data, never as a plugin.
 */

/** Who the pills are for; `null` where a surface has no people list. */
const Mentions = createContext<MentionDirectory | null>(null);

/**
 * A `@handle` the tree step below set apart: a pill when it names somebody
 * (LAI-868), the same characters with no element around them when not.
 */
function MentionPill({
  handle,
  children,
}: {
  readonly handle: string;
  readonly children: ReactNode;
}) {
  const directory = useContext(Mentions);
  const kind = directory === null ? null : mentionKind(handle, directory);
  return kind === null ? <>{children}</> : <span className={mentionClass(kind)}>{children}</span>;
}

/** The handle {@link markMentions} put on a `span`, or `undefined` for any other. */
function mentionOf(node: ExtraProps['node']): string | undefined {
  const handle = node?.properties.dataMention;
  return typeof handle === 'string' ? handle : undefined;
}

const COMPONENTS: Components = {
  // Links leave the board in a new tab rather than replacing it.
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  // Alt text in place of the request.
  img: ({ alt }) =>
    alt !== undefined && alt !== '' ? <span className="md-img-alt">{alt}</span> : null,
  // A wide table scrolls inside the column instead of widening the panel.
  table: ({ node: _node, ...props }) => (
    <div className="md-table-wrap">
      <table {...props} />
    </div>
  ),
  // A mention's span decides its own pill; any other span is drawn as it is.
  span: ({ node, ...props }) => {
    const handle = mentionOf(node);
    return handle === undefined ? (
      <span {...props} />
    ) : (
      <MentionPill handle={handle}>{props.children}</MentionPill>
    );
  },
};

interface HastNode {
  readonly type: string;
  readonly tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/**
 * A hard break is one line break, not two.
 *
 * The renderer writes a hard break (`a··⏎b` or `a\⏎b`) as `<br>` **and** a
 * `"\n"` text after it. Under the description's `white-space: normal` that
 * newline collapses; under a comment's `pre-line` it is a second break, so
 * the reader saw a blank line. This drops that one newline and nothing else:
 * it only edits the text after a `br`, and creates or retags no element.
 */
function oneBreakPerHardBreak() {
  const walk = (node: HastNode): void => {
    const kids = node.children;
    if (kids === undefined) return;
    for (let i = 0; i < kids.length; i++) {
      const next = kids[i + 1];
      if (kids[i]?.tagName === 'br' && next?.type === 'text' && next.value?.startsWith('\n')) {
        next.value = next.value.slice(1);
      }
      const kid = kids[i];
      if (kid !== undefined) walk(kid);
    }
  };
  return walk;
}

/** Where a `@` is code or a link's words, and so never a pill. */
const NO_MENTIONS_INSIDE = new Set(['code', 'pre', 'a']);

/**
 * Every `@handle` the server's grammar matches, set apart (LAI-868).
 *
 * Each match in a **text** node becomes a `span` holding exactly the matched
 * characters, marked with its handle; {@link MentionPill} decides whether it
 * is a pill. It splits text and nothing else: it never reads or creates raw
 * HTML, never retags an element, and leaves code, code blocks and link text as
 * they are. A text node is matched on its own, so a mention opening a bold or
 * a line reads as the server reads `**@grace**` — the character before the
 * `@` is markup, not part of an address.
 */
function markMentions() {
  const walk = (node: HastNode): void => {
    const kids = node.children;
    if (kids === undefined) return;
    const next: HastNode[] = [];
    for (const kid of kids) {
      if (kid.type === 'element' && NO_MENTIONS_INSIDE.has(kid.tagName ?? '')) {
        next.push(kid);
        continue;
      }
      if (kid.type !== 'text' || kid.value === undefined) {
        walk(kid);
        next.push(kid);
        continue;
      }
      const text = kid.value;
      let at = 0;
      for (const found of findMentions(text)) {
        if (found.start > at) next.push({ type: 'text', value: text.slice(at, found.start) });
        next.push({
          type: 'element',
          tagName: 'span',
          properties: { dataMention: found.handle },
          children: [{ type: 'text', value: text.slice(found.start, found.end) }],
        });
        at = found.end;
      }
      if (at === 0) next.push(kid);
      else if (at < text.length) next.push({ type: 'text', value: text.slice(at) });
    }
    node.children = next;
  };
  return walk;
}

const MENTIONS = [markMentions];
const MENTIONS_AND_SINGLE_HARD_BREAKS = [oneBreakPerHardBreak, markMentions];

export interface TaskMarkdownProps {
  readonly source: string;
  /** Added beside `md`, for a surface that sizes it differently. */
  readonly className?: string;
  /** Extra element renderers. `a`, `img`, `table` and `span` above always win. */
  readonly components?: Components;
  /**
   * A hard break is one line break. For a surface whose paragraphs are
   * `white-space: pre-line`, where the newline after a `<br>` would show as a
   * second break. See {@link oneBreakPerHardBreak}.
   */
  readonly singleHardBreaks?: boolean;
  /**
   * Who `@` can name — the panel's people list, handles as it builds them —
   * so a mention of one of them is a pill (LAI-868). Without it, no pills.
   */
  readonly people?: readonly MentionCandidate[] | undefined;
  /** The reader, whose own mention is the stronger pill. */
  readonly meId?: string | undefined;
}

export function TaskMarkdown({
  source,
  className,
  components,
  singleHardBreaks = false,
  people,
  meId,
}: TaskMarkdownProps) {
  const directory = useMemo(() => (people === undefined ? null : { people, meId }), [people, meId]);
  return (
    <div className={className === undefined ? 'md' : `md ${className}`}>
      <Mentions.Provider value={directory}>
        <Markdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={singleHardBreaks ? MENTIONS_AND_SINGLE_HARD_BREAKS : MENTIONS}
          components={components === undefined ? COMPONENTS : { ...components, ...COMPONENTS }}
        >
          {source}
        </Markdown>
      </Mentions.Provider>
    </div>
  );
}
