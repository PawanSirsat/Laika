import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DocumentMarkdown } from './DocumentMarkdown.tsx';
import type { DiagramImages } from './DocDiagram.tsx';
import { extractOutline, outlineTree, type OutlineNode } from './outline.ts';
import {
  anchorFor,
  locate,
  nextAnnotationId,
  type Anchor,
  type Annotation,
} from './annotations.ts';
import { prefersReducedMotion } from '../../theme/motion.ts';

/**
 * The reading surface of the deliverable trial (LAI-1131): a document with
 * its outline (T2, T3), comments in the margin (T8), a focus mode (T9) and a
 * print path (T10). The renderer itself is {@link DocumentMarkdown}.
 *
 * Nothing here talks to the server. Comments live in the caller's state and
 * are gone on reload; the margin says so.
 */

/* ---- text offsets, the DOM half of annotations.ts ---- */

function textNodes(root: Node): Text[] {
  const out: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) out.push(n as Text);
  return out;
}

/** The character offset of a DOM position within `root`'s text. */
function offsetOf(root: Node, container: Node, offset: number): number {
  const probe = document.createRange();
  probe.selectNodeContents(root);
  probe.setEnd(container, offset);
  return probe.toString().length;
}

/** A Range over `root`'s text `[start, end)`. */
function rangeAt(root: Node, start: number, end: number): Range | null {
  let seen = 0;
  const range = document.createRange();
  let started = false;
  for (const node of textNodes(root)) {
    const length = node.data.length;
    if (!started && start <= seen + length) {
      range.setStart(node, start - seen);
      started = true;
    }
    if (started && end <= seen + length) {
      range.setEnd(node, end - seen);
      return range;
    }
    seen += length;
  }
  return null;
}

/** The id of the last heading at or before `node`. */
function headingBefore(root: HTMLElement, node: Node): string {
  let found = '';
  for (const h of root.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id], h4[id]')) {
    if (h === node || h.contains(node)) return h.id;
    if (h.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) found = h.id;
    else break;
  }
  return found;
}

const HIGHLIGHT = 'doc-annotation';

function supportsHighlights(): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function';
}

/* ---- the outline ---- */

function OutlineList({
  nodes,
  active,
  onGo,
}: {
  readonly nodes: readonly OutlineNode[];
  readonly active: string;
  readonly onGo: (id: string) => void;
}): ReactNode {
  return (
    <ol className="doc-outline-level">
      {nodes.map((n) => (
        <li key={n.id}>
          <a
            href={`#${n.id}`}
            className="doc-outline-link"
            data-depth={n.depth}
            aria-current={n.id === active ? 'location' : undefined}
            onClick={(e) => {
              e.preventDefault();
              onGo(n.id);
            }}
          >
            {n.text}
          </a>
          {n.children.length > 0 ? (
            <OutlineList nodes={n.children} active={active} onGo={onGo} />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export interface DocumentReaderProps {
  readonly documentId: string;
  readonly title: string;
  readonly version: string;
  readonly versionLabel: string;
  readonly source: string;
  readonly diagrams?: DiagramImages | undefined;
  readonly annotations: readonly Annotation[];
  readonly onAnnotationsChange: (next: readonly Annotation[]) => void;
  /** Ask the reader to show a section, e.g. from the compare view. */
  readonly goTo?: string | undefined;
}

interface Pending {
  readonly anchor: Anchor;
  readonly top: number;
  readonly left: number;
}

export function DocumentReader({
  documentId,
  title,
  version,
  versionLabel,
  source,
  diagrams,
  annotations,
  onAnnotationsChange,
  goTo,
}: DocumentReaderProps) {
  const outline = useMemo(() => outlineTree(extractOutline(source)), [source]);
  const article = useRef<HTMLElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const focusOpener = useRef<HTMLButtonElement>(null);
  const [active, setActive] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [draft, setDraft] = useState<{ anchor: Anchor; text: string } | null>(null);
  const [located, setLocated] = useState<ReadonlyMap<string, boolean>>(new Map());

  const root = (): HTMLElement | null => body.current?.querySelector('.doc-body') ?? null;

  /* T3: go to a section — scroll, focus the heading, keep the URL shareable. */
  const go = useCallback((id: string) => {
    const target = document.getElementById(id);
    if (target === null) return;
    const reduce = prefersReducedMotion();
    target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    target.focus({ preventScroll: true });
    history.replaceState(history.state, '', `${location.pathname}${location.search}#${id}`);
    setActive(id);
    setMenuOpen(false);
  }, []);

  /* A deep link restores its position; so does the compare view's "Read". */
  useEffect(() => {
    const wanted = goTo ?? (location.hash.startsWith('#h-') ? location.hash.slice(1) : '');
    if (wanted === '') return;
    document.getElementById(wanted)?.scrollIntoView({ block: 'start' });
    setActive(wanted);
  }, [source, goTo]);

  /* T2: the current section, tracked as headings cross a line near the top. */
  useEffect(() => {
    const el = root();
    if (el === null) return;
    const headings = [...el.querySelectorAll<HTMLElement>('h1[id], h2[id], h3[id]')];
    if (headings.length === 0) return;
    const pick = (): void => {
      const line = 80;
      let current = headings[0]?.id ?? '';
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= line) current = h.id;
        else break;
      }
      setActive(current);
    };
    /*
     * Two signals, one answer. The observer fires when a heading enters or
     * leaves the viewport — which catches a jump (a deep link, "go to") that
     * carries a heading past any narrow band in a single frame. A scroll, at
     * most once a frame, catches the heading crossing the line while both
     * stay on screen. `pick` reads positions either way, so they cannot
     * disagree.
     */
    const observer = new IntersectionObserver(pick, { threshold: [0, 1] });
    for (const h of headings) observer.observe(h);
    let frame = 0;
    const onScroll = (): void => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        pick();
      });
    };
    document.addEventListener('scroll', onScroll, { capture: true, passive: true });
    pick();
    return () => {
      observer.disconnect();
      document.removeEventListener('scroll', onScroll, { capture: true });
      cancelAnimationFrame(frame);
    };
  }, [source, focus]);

  /* T8: highlight every comment's words, and note which are outdated. */
  const mine = useMemo(
    () => annotations.filter((a) => a.documentId === documentId),
    [annotations, documentId],
  );
  useEffect(() => {
    const el = root();
    if (el === null) return;
    const text = el.textContent;
    const ranges: Range[] = [];
    const found = new Map<string, boolean>();
    for (const a of mine) {
      const at = locate(text, a.anchor);
      found.set(a.id, at !== null);
      if (at === null) continue;
      const range = rangeAt(el, at.start, at.end);
      if (range !== null) ranges.push(range);
    }
    setLocated(found);
    if (!supportsHighlights()) return;
    CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
    return () => {
      CSS.highlights.delete(HIGHLIGHT);
    };
  }, [mine, source]);

  /* T8: a selection inside the document offers "Comment". */
  const readSelection = (): void => {
    const el = root();
    const container = article.current;
    const selection = window.getSelection();
    if (el === null || container === null || selection === null || selection.isCollapsed) {
      setPending(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) {
      setPending(null);
      return;
    }
    const text = el.textContent;
    const start = offsetOf(el, range.startContainer, range.startOffset);
    const end = offsetOf(el, range.endContainer, range.endOffset);
    if (text.slice(start, end).trim() === '') {
      setPending(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    const box = container.getBoundingClientRect();
    setPending({
      anchor: anchorFor(text, start, end, headingBefore(el, range.startContainer)),
      top: rect.bottom - box.top + container.scrollTop + 6,
      left: Math.max(0, Math.min(rect.left - box.left, box.width - 140)),
    });
  };

  const startComment = (): void => {
    if (pending === null) return;
    setDraft({ anchor: pending.anchor, text: '' });
    setPending(null);
  };

  const saveComment = (): void => {
    if (draft === null || draft.text.trim() === '') return;
    onAnnotationsChange([
      ...annotations,
      {
        id: nextAnnotationId(),
        documentId,
        version,
        anchor: draft.anchor,
        body: draft.text.trim(),
      },
    ]);
    setDraft(null);
    window.getSelection()?.removeAllRanges();
  };

  const showComment = (a: Annotation): void => {
    const el = root();
    if (el === null) return;
    const at = locate(el.textContent, a.anchor);
    if (at === null) return;
    const range = rangeAt(el, at.start, at.end);
    const host = range?.startContainer.parentElement;
    host?.scrollIntoView({ block: 'center' });
  };

  /* T9: focus mode — Escape leaves, and focus goes back where it came from. */
  const wasFocus = useRef(false);
  useEffect(() => {
    if (focus) {
      wasFocus.current = true;
      article.current?.focus({ preventScroll: true });
      const onKey = (e: KeyboardEvent): void => {
        if (e.key === 'Escape') setFocus(false);
      };
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('keydown', onKey);
      };
    }
    if (wasFocus.current) {
      wasFocus.current = false;
      focusOpener.current?.focus();
    }
    return undefined;
  }, [focus]);

  const headingText = (id: string): string =>
    id === ''
      ? 'Before the first heading'
      : (document.getElementById(id)?.textContent ?? id).replace(/#$/, '');

  return (
    <div className="doc-reader" data-focus={focus ? 'true' : 'false'}>
      <nav className="doc-outline" aria-label="Contents">
        <button
          type="button"
          className="doc-outline-toggle"
          aria-expanded={menuOpen}
          aria-controls="doc-outline-list"
          onClick={() => {
            setMenuOpen((v) => !v);
          }}
        >
          Contents
        </button>
        <div
          id="doc-outline-list"
          className="doc-outline-list"
          data-open={menuOpen ? 'true' : 'false'}
        >
          <p className="doc-outline-title" aria-hidden="true">
            Contents
          </p>
          <OutlineList nodes={outline} active={active} onGo={go} />
        </div>
      </nav>

      <article
        ref={article}
        className="doc-reading"
        tabIndex={-1}
        aria-label={`${title}, ${versionLabel}`}
        onPointerUp={readSelection}
        onKeyUp={(e) => {
          if (e.key !== 'Escape') readSelection();
        }}
      >
        <div className="doc-reading-bar">
          <button
            ref={focusOpener}
            type="button"
            className="doc-button"
            data-action="focus"
            onClick={() => {
              setFocus(true);
            }}
          >
            Focus mode
          </button>
          <button
            type="button"
            className="doc-button"
            data-action="print"
            onClick={() => {
              window.print();
            }}
          >
            Print / Save as PDF
          </button>
        </div>
        {focus ? (
          <div className="doc-focus-bar">
            <span className="doc-focus-title">{title}</span>
            <button
              type="button"
              className="doc-button"
              data-action="exit-focus"
              onClick={() => {
                setFocus(false);
              }}
            >
              Exit focus <kbd>Esc</kbd>
            </button>
          </div>
        ) : null}
        <p className="doc-print-meta">
          {title} · {versionLabel} · illustrative trial fixture “{documentId}”
        </p>
        <div ref={body} className="doc-measure">
          <DocumentMarkdown source={source} diagrams={diagrams} />
        </div>
        {pending !== null ? (
          <button
            type="button"
            className="doc-comment-float"
            data-action="comment"
            style={{ top: pending.top, left: pending.left }}
            onPointerUp={(e) => {
              e.stopPropagation();
            }}
            onClick={startComment}
          >
            Comment
          </button>
        ) : null}
      </article>

      <aside className="doc-margin" aria-labelledby="doc-margin-title">
        <div className="doc-margin-head">
          <h2 id="doc-margin-title" className="doc-margin-title">
            Comments
          </h2>
          <span className="doc-prototype">Prototype — not saved</span>
        </div>
        <p className="doc-margin-help">
          Select text in the document, then choose <strong>Comment</strong>. Comments live in this
          tab only and are lost on reload.
        </p>
        <button
          type="button"
          className="doc-button"
          disabled={pending === null}
          onClick={startComment}
        >
          Comment on selection
        </button>
        {draft !== null ? (
          <form
            className="doc-note doc-note-draft"
            onSubmit={(e) => {
              e.preventDefault();
              saveComment();
            }}
          >
            <blockquote className="doc-note-quote">{draft.anchor.exact}</blockquote>
            <label className="visually-hidden" htmlFor="doc-note-text">
              Comment
            </label>
            <textarea
              id="doc-note-text"
              className="doc-note-input"
              rows={3}
              autoFocus
              value={draft.text}
              onChange={(e) => {
                setDraft({ ...draft, text: e.target.value });
              }}
            />
            <div className="doc-note-actions">
              <button type="submit" className="doc-button doc-button-primary">
                Save
              </button>
              <button
                type="button"
                className="doc-button"
                onClick={() => {
                  setDraft(null);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        <ul className="doc-notes">
          {mine.map((a) => {
            const outdated = located.get(a.id) === false;
            return (
              <li
                key={a.id}
                className="doc-note"
                data-note={a.id}
                data-outdated={outdated ? 'true' : 'false'}
              >
                <p className="doc-note-where">
                  {outdated ? (
                    <span className="doc-note-outdated">Outdated — words not in this version</span>
                  ) : (
                    headingText(a.anchor.headingId)
                  )}
                  {a.version !== version ? (
                    <span className="doc-note-version"> · made on {a.version}</span>
                  ) : null}
                </p>
                <blockquote className="doc-note-quote">{a.anchor.exact}</blockquote>
                <p className="doc-note-body">{a.body}</p>
                <div className="doc-note-actions">
                  <button
                    type="button"
                    className="doc-link-button"
                    disabled={outdated}
                    onClick={() => {
                      showComment(a);
                    }}
                  >
                    Show
                  </button>
                  <button
                    type="button"
                    className="doc-link-button"
                    aria-label={`Remove comment: ${a.body}`}
                    onClick={() => {
                      onAnnotationsChange(annotations.filter((x) => x.id !== a.id));
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </aside>
    </div>
  );
}
