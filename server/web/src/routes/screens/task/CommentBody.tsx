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
      <TaskMarkdown source={body} className="md-comment" components={COMMENT_COMPONENTS} />
    </div>
  );
}
