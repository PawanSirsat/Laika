import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
 * `img` past the rule above. The one transform a surface needs is owned here
 * and switched on by a boolean.
 */

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
};

interface HastNode {
  readonly type: string;
  readonly tagName?: string;
  value?: string;
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

const SINGLE_HARD_BREAKS = [oneBreakPerHardBreak];

export interface TaskMarkdownProps {
  readonly source: string;
  /** Added beside `md`, for a surface that sizes it differently. */
  readonly className?: string;
  /** Extra element renderers. `a`, `img` and `table` above always win. */
  readonly components?: Components;
  /**
   * A hard break is one line break. For a surface whose paragraphs are
   * `white-space: pre-line`, where the newline after a `<br>` would show as a
   * second break. See {@link oneBreakPerHardBreak}.
   */
  readonly singleHardBreaks?: boolean;
}

export function TaskMarkdown({
  source,
  className,
  components,
  singleHardBreaks = false,
}: TaskMarkdownProps) {
  return (
    <div className={className === undefined ? 'md' : `md ${className}`}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={singleHardBreaks ? SINGLE_HARD_BREAKS : undefined}
        components={components === undefined ? COMPONENTS : { ...components, ...COMPONENTS }}
      >
        {source}
      </Markdown>
    </div>
  );
}
