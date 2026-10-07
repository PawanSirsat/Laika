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
 * Comments do not use this. They keep LAI-284's fences-only rule, which is a
 * separate decision about a separate surface.
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

export function TaskMarkdown({ source }: { readonly source: string }) {
  return (
    <div className="md">
      <Markdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
        {source}
      </Markdown>
    </div>
  );
}
