import { useMemo, useRef, type ReactNode } from 'react';
import { CopyButton } from '../CopyButton.tsx';
import { highlight, type CodeNode } from './highlight.ts';

/**
 * A fenced code block in a document (LAI-1131, T4): highlighted when its
 * language is one `highlight.ts` knows, plain when not, always with its
 * language named and a copy button. Line count shown for long blocks, since
 * "how long is this?" is the first thing a reviewer of a 200-line listing
 * asks.
 */

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  javascript: 'JavaScript',
  sql: 'SQL',
  bash: 'Shell',
  sh: 'Shell',
  shell: 'Shell',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
};

function render(nodes: readonly CodeNode[]): ReactNode[] {
  return nodes.map((node, i) =>
    node.type === 'text' ? (
      node.value
    ) : (
      <span key={i} className={node.className.join(' ')}>
        {render(node.children)}
      </span>
    ),
  );
}

export interface DocCodeBlockProps {
  readonly code: string;
  readonly language: string;
}

export function DocCodeBlock({ code, language }: DocCodeBlockProps) {
  const tree = useMemo(
    () => (language === '' ? null : highlight(code, language)),
    [code, language],
  );
  const pre = useRef<HTMLPreElement>(null);
  const lines = code.split('\n').length;
  const name = LANGUAGE_NAMES[language] ?? (language === '' ? 'Text' : language);
  return (
    <figure className="doc-code" data-language={language === '' ? 'text' : language}>
      <figcaption className="doc-code-bar">
        <span className="doc-code-lang">{name}</span>
        {lines > 20 ? <span className="doc-code-lines">{lines} lines</span> : null}
        <CopyButton text={code} selects={pre} label="Copy code" what={`the ${name} block`} />
      </figcaption>
      {/* Focusable so a keyboard reader can scroll a wide listing. */}
      <pre ref={pre} className="doc-code-pre" tabIndex={0}>
        <code className={tree === null ? undefined : 'hljs'}>
          {tree === null ? code : render(tree)}
        </code>
      </pre>
    </figure>
  );
}
