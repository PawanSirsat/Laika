import type { Components, ExtraProps } from 'react-markdown';
import { TaskMarkdown } from './TaskMarkdown.tsx';
import './task-panel.css';

export interface CommentBodyProps {
  readonly body: string;
}

/** The fence's tag, from the `language-…` class the renderer puts on `code`. */
function fenceLanguage(pre: ExtraProps['node']): string | undefined {
  const code = pre?.children[0];
  if (code?.type !== 'element') return undefined;
  const classes = code.properties.className;
  if (!Array.isArray(classes)) return undefined;
  const tag = classes.map(String).find((c) => c.startsWith('language-'));
  return tag?.slice('language-'.length);
}

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
 * the reader saw a blank line. This drops that one newline and nothing else.
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

const COMMENT_PLUGINS = [oneBreakPerHardBreak];

const COMMENT_COMPONENTS: Components = {
  /*
   * LAI-284's code block, kept: the thread's own `.comment-code` box, with the
   * fence's tag as an attribute. **No language label** — the design's block
   * carries none; the tag is metadata for a highlighter we do not have.
   */
  pre: ({ node, ...props }) => (
    <pre {...props} className="comment-code" data-language={fenceLanguage(node)} />
  ),
};

/**
 * A comment's body, rendered as markdown (LAI-734).
 *
 * The owner, on ONR-305: an agent's progress comment printed `**Progress**`,
 * backticks and `- [ ]` as raw text, beside a description that rendered them.
 * It now goes through the description's renderer, `TaskMarkdown`, so it gets
 * the same safety rules — elements, never an HTML string; raw HTML as text;
 * `javascript:` links emptied; no images loaded — and they live in one place.
 *
 * This retires LAI-284's fences-only parser. Its reasons were sound for a
 * hand-written parser, where every construct was new code to trust; they do
 * not apply to a renderer the description already trusts with the same
 * people's text. An unclosed fence still runs to the end, as CommonMark says.
 */
export function CommentBody({ body }: CommentBodyProps) {
  return (
    <div className="panel-comment-body">
      <TaskMarkdown
        source={body}
        className="md-comment"
        components={COMMENT_COMPONENTS}
        rehypePlugins={COMMENT_PLUGINS}
      />
    </div>
  );
}
