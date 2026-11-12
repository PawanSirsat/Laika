import { createContext, useContext, type ReactNode } from 'react';
import Markdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { headingIds } from './outline.ts';
import { callouts, tableCaptions, type CalloutKind } from './doc-plugins.ts';
import { DocCodeBlock } from './DocCodeBlock.tsx';
import { DocDiagram, type DiagramImages } from './DocDiagram.tsx';
import { DocTable } from './DocTable.tsx';

/**
 * A long-form deliverable, rendered (LAI-1131 — the deliverable design trial).
 *
 * A sibling of `TaskMarkdown`, not a change to it. TaskMarkdown deliberately
 * lets no caller replace `a`, `img` or `table`, and gives headings no ids;
 * a document reader needs anchors, per-type code blocks, captioned tables and
 * callouts. It keeps TaskMarkdown's three safety rules exactly:
 *
 * - **No raw HTML.** No `rehype-raw`; a `<script>` in a fixture is text.
 * - **URLs through `defaultUrlTransform`** (react-markdown's default, not
 *   overridden), which empties `javascript:` and other non-web schemes.
 * - **Images are not loaded**; the alt text stands in. Pre-rendered diagrams
 *   are the one picture, and they come from the app's own build, never from a
 *   URL in the document.
 *
 * The tree steps (heading ids, callouts, captions) are owned here and take no
 * caller input. Whether this folds into TaskMarkdown is a Phase D decision.
 */

/** Pre-rendered diagrams by `diagramKey`, from whoever owns the document. */
const Diagrams = createContext<DiagramImages>(new Map());

interface HastLike {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastLike[];
}

function textOf(node: HastLike | undefined): string {
  if (node === undefined) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(textOf).join('');
}

/** `language-ts` → `ts`; nothing → `''`. */
function languageOf(code: HastLike | undefined): string {
  const raw = code?.properties?.className;
  const list = Array.isArray(raw) ? raw : [];
  const found = list.find((c): c is string => typeof c === 'string' && c.startsWith('language-'));
  return found === undefined ? '' : found.slice('language-'.length);
}

function Pre({ node }: ExtraProps) {
  const code = (node as HastLike | undefined)?.children?.find((k) => k.tagName === 'code');
  const language = languageOf(code);
  // Fenced code ends with a newline the reader never typed.
  const text = textOf(code).replace(/\n$/, '');
  if (language === 'mermaid') return <MermaidFence source={text} />;
  return <DocCodeBlock code={text} language={language} />;
}

function MermaidFence({ source }: { readonly source: string }) {
  const images = useContext(Diagrams);
  return <DocDiagram source={source} images={images} />;
}

const CALLOUT_LABEL: Readonly<Record<CalloutKind, string>> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

function Heading({
  level,
  id,
  children,
}: {
  readonly level: 1 | 2 | 3 | 4 | 5 | 6;
  readonly id: string | undefined;
  readonly children: ReactNode;
}) {
  const Tag = (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const)[level - 1] ?? 'h6';
  return (
    <Tag id={id} className="doc-heading" tabIndex={-1}>
      {children}
      {id !== undefined && level > 1 ? (
        <a className="doc-anchor" href={`#${id}`} aria-label="Link to this section">
          #
        </a>
      ) : null}
    </Tag>
  );
}

const COMPONENTS: Components = {
  h1: ({ id, children }) => (
    <Heading level={1} id={id}>
      {children}
    </Heading>
  ),
  h2: ({ id, children }) => (
    <Heading level={2} id={id}>
      {children}
    </Heading>
  ),
  h3: ({ id, children }) => (
    <Heading level={3} id={id}>
      {children}
    </Heading>
  ),
  h4: ({ id, children }) => (
    <Heading level={4} id={id}>
      {children}
    </Heading>
  ),
  h5: ({ id, children }) => (
    <Heading level={5} id={id}>
      {children}
    </Heading>
  ),
  h6: ({ id, children }) => (
    <Heading level={6} id={id}>
      {children}
    </Heading>
  ),
  pre: Pre,
  table: ({ node, children }) => {
    const columns = Number((node as HastLike | undefined)?.properties?.dataColumns ?? 0);
    return <DocTable columns={columns}>{children}</DocTable>;
  },
  blockquote: ({ node, children }) => {
    const kind = (node as HastLike | undefined)?.properties?.dataCallout as CalloutKind | undefined;
    if (kind === undefined) return <blockquote>{children}</blockquote>;
    return (
      <aside className="doc-callout" data-callout={kind} aria-label={CALLOUT_LABEL[kind]}>
        <p className="doc-callout-label" aria-hidden="true">
          <span className="doc-callout-icon" />
          {CALLOUT_LABEL[kind]}
        </p>
        {children}
      </aside>
    );
  },
  // In-page links (footnotes, cross-references) stay in the page; everything
  // else leaves the board in a new tab, as TaskMarkdown does.
  a: ({ node: _node, href, ...props }) =>
    href?.startsWith('#') === true ? (
      <a href={href} {...props} />
    ) : (
      <a href={href} {...props} target="_blank" rel="noopener noreferrer" />
    ),
  img: ({ alt }) =>
    alt !== undefined && alt !== '' ? <span className="md-img-alt">{alt}</span> : null,
};

const REHYPE = [headingIds, callouts, tableCaptions];
const REMARK = [remarkGfm];

export interface DocumentMarkdownProps {
  readonly source: string;
  /** Pre-rendered diagrams, by `diagramKey`. A diagram not here shows its source. */
  readonly diagrams?: DiagramImages | undefined;
}

export function DocumentMarkdown({ source, diagrams }: DocumentMarkdownProps) {
  return (
    <div className="doc-body">
      <Diagrams.Provider value={diagrams ?? new Map()}>
        <Markdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={COMPONENTS}>
          {source}
        </Markdown>
      </Diagrams.Provider>
    </div>
  );
}
