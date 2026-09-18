import { splitFences } from './comment-body.ts';
import './task-panel.css';

export interface CommentBodyProps {
  readonly body: string;
}

/**
 * A comment's body, with fenced code rendered as code (LAI-284).
 *
 * The parsing lives in `comment-body.ts`; this places the result and decides
 * nothing. Everything is rendered as **text nodes** — React escapes them — so
 * there is no path from a comment to markup.
 */
export function CommentBody({ body }: CommentBodyProps) {
  const blocks = splitFences(body);

  // No fence at all is the common case, and it should cost nothing.
  if (blocks.length === 1 && blocks[0]?.kind === 'text') {
    return <p className="panel-comment-body">{blocks[0].content}</p>;
  }

  return (
    <div className="panel-comment-body">
      {blocks.map((block, i) =>
        block.kind === 'code' ? (
          <pre key={i} className="comment-code">
            {block.language !== undefined && (
              <span className="comment-code-lang">{block.language}</span>
            )}
            <code>{block.content}</code>
          </pre>
        ) : (
          <p key={i} className="comment-para">
            {block.content}
          </p>
        ),
      )}
    </div>
  );
}
