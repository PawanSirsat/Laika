/**
 * Code highlighting for documents (LAI-1131, T4): lowlight, i.e. highlight.js
 * run to a syntax tree, with classes and no inline style.
 *
 * **Why lowlight and not Shiki.** Shiki's default engine is WebAssembly, which
 * `script-src 'self'` refuses (no `'wasm-unsafe-eval'`); its JavaScript regex
 * engine works, but its `css-variables` theme writes a `style` attribute per
 * token, so a code theme would live in two places. lowlight emits `hljs-*`
 * classes, and `documents.css` maps each class to a theme token — colours stay
 * in `theme.css`, and the theme-single-source test keeps it that way.
 *
 * **Core plus named languages**, not `common`: `common` registers 37 grammars
 * a deliverable will rarely need. The trial's set is below; adding one is one
 * import and one line.
 */

import { createLowlight } from 'lowlight';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import yaml from 'highlight.js/lib/languages/yaml';
import plaintext from 'highlight.js/lib/languages/plaintext';

const lowlight = createLowlight({
  bash,
  json,
  sql,
  typescript,
  javascript,
  yaml,
  plaintext,
});
lowlight.registerAlias({ bash: ['sh', 'shell', 'zsh'], typescript: ['ts', 'tsx'] });
lowlight.registerAlias({ javascript: ['js', 'jsx', 'mjs'], yaml: ['yml'], plaintext: ['text'] });

/** The names this module highlights, aliases included. */
export function isHighlighted(language: string): boolean {
  return lowlight.registered(language);
}

/** A highlighted node: an element with classes, or text. */
export type CodeNode =
  | { readonly type: 'text'; readonly value: string }
  | {
      readonly type: 'element';
      readonly className: readonly string[];
      readonly children: readonly CodeNode[];
    };

interface LowNode {
  type: string;
  value?: string;
  properties?: { className?: unknown };
  children?: LowNode[];
}

function convert(node: LowNode): CodeNode[] {
  if (node.type === 'text') return [{ type: 'text', value: node.value ?? '' }];
  const kids = (node.children ?? []).flatMap(convert);
  if (node.type !== 'element') return kids;
  const raw = node.properties?.className;
  const className = Array.isArray(raw) ? raw.filter((c): c is string => typeof c === 'string') : [];
  return [{ type: 'element', className, children: kids }];
}

/**
 * `code` highlighted as `language`, or `null` when the language is unknown —
 * the caller then shows the text plain. Never guesses: auto-detection is
 * slow and wrong often enough to mislead.
 */
export function highlight(code: string, language: string): CodeNode[] | null {
  if (!lowlight.registered(language)) return null;
  const tree = lowlight.highlight(language, code) as unknown as LowNode;
  return convert(tree);
}
