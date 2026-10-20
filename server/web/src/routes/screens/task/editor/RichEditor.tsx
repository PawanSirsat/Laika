import { Placeholder } from '@tiptap/extensions';
import { Selection, TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../../../../api/errors.ts';
import { Dropdown } from '../../../../components/Dropdown.tsx';
import { Button } from '../../../../components/forms/Button.tsx';
import type { CardCandidate, MentionCandidate, RichEditorProps } from '../LazyRichEditor.tsx';
import { MARKDOWN_EXTENSIONS } from './extensions.ts';
import { createBridge, normaliseMarkdown, openDocument, toMarkdown } from './markdown-bridge.ts';
import { reducePastedHtml } from './paste.ts';
import './rich-editor.css';

/**
 * The task panel's editor (LAI-827): Jira's issue-view editor, over markdown.
 *
 * It opens in place, where the text was, looking like the text it replaced —
 * the document is drawn with the reading view's `.md` styles — with a toolbar
 * above and Save / Cancel below. What goes to the server is markdown, written
 * by `markdown-bridge.ts`, which also decides whether a document may open in
 * the rich view at all. One that would not survive the trip opens as Markdown
 * source, says why, and is sent back exactly as the person leaves it.
 *
 * ## Keys
 *
 * `⌘/Ctrl+Enter` saves. `Escape` cancels, and asks first when something
 * changed — an Escape is easy to press by accident, a Cancel click is not, so
 * Cancel discards at once. An Escape the editor consumes is `preventDefault`ed,
 * which is what tells the drawer not to close as well.
 */

const bridge = createBridge(MARKDOWN_EXTENSIONS);

type Mode = 'rich' | 'source';

/** An open suggestion list: people after `@`, or cards from the toolbar. */
type Picker =
  | {
      readonly kind: 'mention';
      readonly query: string;
      readonly from: number;
      readonly to: number;
      readonly active: number;
      readonly top: number;
      readonly left: number;
    }
  | { readonly kind: 'card'; readonly query: string; readonly active: number }
  | { readonly kind: 'link'; readonly href: string; readonly error?: string | undefined };

const TEXT_STYLES = [
  { value: '0', label: 'Normal text' },
  { value: '1', label: 'Heading 1' },
  { value: '2', label: 'Heading 2' },
  { value: '3', label: 'Heading 3' },
] as const;

/** What a save from the source view sends: no leading blank lines, no trailing space. */
function tidySource(text: string): string {
  return text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '');
}

/** The people whose name or handle starts with what was typed after `@`. */
function peopleMatching(people: readonly MentionCandidate[], query: string): MentionCandidate[] {
  const q = query.toLowerCase();
  return people
    .filter(
      (p) =>
        q === '' ||
        p.name
          .toLowerCase()
          .split(/\s+/)
          .some((word) => word.startsWith(q)) ||
        (p.handle?.toLowerCase().startsWith(q) ?? false),
    )
    .slice(0, 8);
}

/** Cards whose key or title holds the query; an exact key first. */
function cardsMatching(cards: readonly CardCandidate[], query: string): CardCandidate[] {
  const q = query.trim().toLowerCase();
  const hits = cards.filter(
    (c) => q === '' || c.key.toLowerCase().includes(q) || c.title.toLowerCase().includes(q),
  );
  return hits
    .sort((a, b) => Number(b.key.toLowerCase() === q) - Number(a.key.toLowerCase() === q))
    .slice(0, 8);
}

/**
 * A link address a person typed, made usable, or `null`.
 *
 * `https://`, `http://`, `mailto:` and a path on this board (`/board?…`) are
 * kept; a bare `example.com` gets `https://`. Anything else — `javascript:`,
 * `data:` — is refused rather than stored.
 */
function usableHref(typed: string): string | null {
  const href = typed.trim();
  if (href === '') return null;
  if (/^(?:https?:\/\/|mailto:)\S+$/i.test(href)) return href;
  if (/^\/(?!\/)\S*$/.test(href)) return href;
  if (/^[\w-]+(?:\.[\w-]+)+(?:[/?#]\S*)?$/.test(href)) return `https://${href}`;
  return null;
}

/** Where the `@` the caret is after sits, and what follows it. */
function findMention(editor: Editor): { query: string; from: number; to: number } | null {
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code === true) return null;
  if (editor.isActive('code')) return null;
  const before = $from.parent.textBetween(
    Math.max(0, $from.parentOffset - 40),
    $from.parentOffset,
    undefined,
    '\ufffc',
  );
  const match = /(?:^|[\s(])@([\p{L}\p{N}._-]{0,30})$/u.exec(before);
  if (match === null) return null;
  const query = match[1] ?? '';
  return { query, from: $from.pos - query.length - 1, to: $from.pos };
}

function Tool({
  label,
  pressed,
  disabled,
  onRun,
  children,
}: {
  readonly label: string;
  readonly pressed?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly onRun: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={pressed === true ? 'rte-tool rte-tool-on' : 'rte-tool'}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      // The editor keeps focus and its selection: a toolbar button acts on it.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={onRun}
    >
      {children}
    </button>
  );
}

/** 16px line icons, drawn in `currentColor` so both themes follow. */
function Glyph({ d, text }: { readonly d?: string; readonly text?: string }) {
  if (text !== undefined) {
    return (
      <span className="rte-glyph" aria-hidden="true">
        {text}
      </span>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d={d}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const ICON = {
  bullet: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  ordered:
    'M10 6h10M10 12h10M10 18h10M4 4v4M3 18h3l-3 3h3M3 10.5a1.5 1.5 0 0 1 3 0c0 1.5-3 2-3 3.5h3',
  task: 'M4 5h5v5H4zM4 14h5v5H4zM5.5 7.5l1 1 2-2M13 7.5h8M13 16.5h8',
  quote: 'M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6',
  codeBlock: 'M4 4h16v16H4zM9 10l-2 2 2 2M15 10l2 2-2 2',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  table: 'M3 4h18v16H3zM3 10h18M3 15h18M9 4v16M15 4v16',
  card: 'M4 5h16v14H4zM8 9h8M8 13h5',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
} as const;

export function RichEditor({
  value,
  label,
  placeholder,
  submitLabel,
  onSubmit,
  onClose,
  people,
  cards,
  compact = false,
  caretAt,
}: RichEditorProps) {
  /** Decided once, on the text editing opened on — never on a later one. */
  const opening = useMemo(() => openDocument(bridge, value), [value]);
  const [mode, setMode] = useState<Mode>(opening.kind);
  const [notice, setNotice] = useState<string | undefined>(
    opening.kind === 'source' ? opening.reason : undefined,
  );
  const [source, setSource] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [picker, setPicker] = useState<Picker | null>(null);
  /** An `@` someone pressed Escape on: no list again until they move on. */
  const dismissedAt = useRef<number | null>(null);
  const wrap = useRef<HTMLDivElement | null>(null);
  const sourceField = useRef<HTMLTextAreaElement | null>(null);

  /** Handlers the editor calls: it is created once, so they are read through a ref. */
  const keys = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const onTransaction = useRef<(editor: Editor) => void>(() => undefined);
  const placeCaret = useRef<(editor: Editor, attempt: number) => void>(() => undefined);

  /*
   * **Built once.** `useEditor` compares its options by reference on every
   * render and calls `setOptions` when they differ, which re-applies the
   * editor's state to its view. Options rebuilt per render — a new
   * Placeholder, new handlers — would make that happen on every render: every
   * keystroke's re-render, every picker move. Everything that changes is read
   * through a ref instead.
   */
  const options = useMemo(
    () => ({
      extensions: [...MARKDOWN_EXTENSIONS, Placeholder.configure({ placeholder })],
      content: opening.kind === 'rich' ? opening.content : null,
      // `style-src-elem 'self'` (LAI-205): an injected <style> would be refused.
      // ProseMirror's own rules are in rich-editor.css instead.
      injectCSS: false,
      // Focused below, where the person clicked, and without scrolling.
      autofocus: false,
      editorProps: {
        attributes: {
          class: 'md md-reading rich-editor-doc',
          'aria-label': label,
          'aria-multiline': 'true',
          role: 'textbox',
        },
        transformPastedHTML: reducePastedHtml,
        handleKeyDown: (_view: unknown, event: KeyboardEvent) => keys.current(event),
        // A dropped file is not text: nothing to insert, and the browser must not open it.
        handleDrop: (_view: unknown, event: DragEvent) =>
          (event.dataTransfer?.files.length ?? 0) > 0,
      },
      onTransaction: ({ editor: current }: { editor: Editor }) => {
        onTransaction.current(current);
      },
      // Fired while the first render is still running: the caret is placed on
      // the next frame, when the document is on the page to be measured.
      onMount: ({ editor: mounted }: { editor: Editor }) => {
        requestAnimationFrame(() => {
          placeCaret.current(mounted, 0);
        });
      },
    }),
    // One editor per opening: its text, label and placeholder are fixed.
    [],
  );
  const editor = useEditor(options);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      link: e.isActive('link'),
      table: e.isActive('table'),
      level: [1, 2, 3, 4, 5, 6].find((level) => e.isActive('heading', { level })) ?? 0,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
      empty: e.isEmpty,
    }),
  });

  /** The markdown a submit would send now. */
  const current = useCallback(
    (): string => (mode === 'rich' ? toMarkdown(bridge, editor.state.doc) : tidySource(source)),
    [editor, mode, source],
  );

  /**
   * Nothing changed, so nothing is sent. In the rich view a document changes
   * only by its content, so the stated normalisation decides; in the source
   * view the person's own characters do.
   */
  const unchanged = useCallback(
    (next: string): boolean =>
      mode === 'rich'
        ? normaliseMarkdown(next) === normaliseMarkdown(value)
        : next === tidySource(value),
    [mode, value],
  );

  const submit = useCallback(async (): Promise<void> => {
    if (busy) return;
    const next = current();
    if (unchanged(next)) {
      onClose();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await onSubmit(next);
    } catch (cause) {
      // The draft stays: a refusal or a blip must never cost what was typed.
      setError(cause instanceof ApiError ? cause.message : 'Could not save that. Try again.');
    } finally {
      setBusy(false);
    }
  }, [busy, current, unchanged, onSubmit, onClose]);

  const requestCancel = useCallback((): void => {
    if (unchanged(current())) onClose();
    else setConfirming(true);
  }, [current, unchanged, onClose]);

  const mentionMatches =
    picker?.kind === 'mention' ? peopleMatching(people, picker.query) : ([] as MentionCandidate[]);

  const insertMention = useCallback(
    (person: MentionCandidate, at: { from: number; to: number }): void => {
      editor
        .chain()
        .focus()
        .insertContentAt(at, `@${person.handle ?? person.name} `)
        .run();
      setPicker(null);
    },
    [editor],
  );

  keys.current = (event: KeyboardEvent): boolean => {
    if (picker?.kind === 'mention' && mentionMatches.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const n = mentionMatches.length;
        setPicker({ ...picker, active: (picker.active + step + n) % n });
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const person = mentionMatches[picker.active] ?? mentionMatches[0];
        if (person !== undefined) insertMention(person, picker);
        return true;
      }
      if (event.key === 'Escape') {
        dismissedAt.current = picker.from;
        setPicker(null);
        return true;
      }
    }
    if (event.key === 'Escape') {
      requestCancel();
      return true;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      void submit();
      return true;
    }
    return false;
  };

  onTransaction.current = (current_: Editor): void => {
    const found = findMention(current_);
    if (found === null || found.from === dismissedAt.current) {
      if (found === null) dismissedAt.current = null;
      setPicker((open) => (open?.kind === 'mention' ? null : open));
      return;
    }
    const box = wrap.current?.getBoundingClientRect();
    const at = current_.view.coordsAtPos(found.from);
    setPicker((open) => ({
      kind: 'mention',
      ...found,
      active: open?.kind === 'mention' && open.query === found.query ? open.active : 0,
      top: at.bottom - (box?.top ?? 0) + 4,
      left: at.left - (box?.left ?? 0),
    }));
  };

  useEffect(() => {
    if (mode === 'source') sourceField.current?.focus({ preventScroll: true });
  }, [mode]);

  /**
   * Once the view exists: the caret where the reading view was clicked. The
   * document is drawn as it was read, so the point lands on the same words,
   * a toolbar's height lower.
   */
  placeCaret.current = (mounted: Editor, attempt: number): void => {
    if (mounted.isDestroyed) return;
    if (!mounted.view.dom.isConnected) {
      // Not on the page yet: try the next frame, for a few.
      if (attempt < 10) {
        requestAnimationFrame(() => {
          placeCaret.current(mounted, attempt + 1);
        });
      }
      return;
    }
    // Clicked into already: that caret is the person's, not ours to move.
    if (opening.kind !== 'rich' || mounted.view.hasFocus()) return;
    const { state, view } = mounted;
    let selection: Selection = Selection.atStart(state.doc);
    if (caretAt !== undefined) {
      const box = view.dom.getBoundingClientRect();
      const style = getComputedStyle(view.dom);
      const hit = view.posAtCoords({
        left: box.left + Number.parseFloat(style.paddingLeft) + caretAt.x,
        top: box.top + Number.parseFloat(style.paddingTop) + caretAt.y,
      });
      if (hit !== null) selection = TextSelection.near(state.doc.resolve(hit.pos));
    }
    /*
     * At once, and not through `commands.focus()`, which focuses a frame
     * later — the same reason as Keep editing below. `view.focus()` does not
     * scroll.
     */
    view.dispatch(state.tr.setSelection(selection));
    view.focus();
  };

  const toggleSource = (): void => {
    if (mode === 'rich') {
      const next = current();
      // Untouched, the source is the text as stored, not the editor's rewrite of it.
      setSource(unchanged(next) ? value : next);
      setPicker(null);
      setMode('source');
      return;
    }
    const reopened = openDocument(bridge, source);
    if (reopened.kind === 'source') {
      setNotice(`This Markdown stays as Markdown. ${reopened.reason}`);
      return;
    }
    editor.commands.setContent(reopened.content, { emitUpdate: false });
    setNotice(undefined);
    setMode('rich');
    editor.commands.focus('end');
  };

  const chain = () => editor.chain().focus();
  const rich = mode === 'rich';

  const applyLink = (typed: string): void => {
    const href = usableHref(typed);
    if (href === null) {
      setPicker({
        kind: 'link',
        href: typed,
        error: 'Use a web address, such as https://example.com.',
      });
      return;
    }
    if (editor.state.selection.empty && !editor.isActive('link')) {
      chain()
        .insertContent([
          { type: 'text', text: typed.trim(), marks: [{ type: 'link', attrs: { href } }] },
          { type: 'text', text: ' ' },
        ])
        .run();
    } else {
      chain().extendMarkRange('link').setLink({ href }).run();
    }
    setPicker(null);
  };

  const insertCard = (card: CardCandidate): void => {
    chain()
      .insertContent([
        { type: 'text', text: card.key, marks: [{ type: 'link', attrs: { href: card.href } }] },
        { type: 'text', text: ' ' },
      ])
      .run();
    setPicker(null);
  };

  const cardMatches = picker?.kind === 'card' ? cardsMatching(cards, picker.query) : [];
  const empty = rich ? state.empty : source.trim() === '';

  return (
    <div
      className={compact ? 'rich-editor rich-editor-compact' : 'rich-editor'}
      ref={wrap}
      data-mode={mode}
    >
      <div className="rte-toolbar" role="toolbar" aria-label="Formatting">
        <span className="rte-style">
          <Dropdown
            variant="bare"
            aria-label="Text style"
            noun="text styles"
            searchable={false}
            disabled={!rich}
            value={String(state.level)}
            options={[
              ...TEXT_STYLES,
              ...(state.level > 3
                ? [{ value: String(state.level), label: `Heading ${String(state.level)}` }]
                : []),
            ]}
            onChange={(level) => {
              const n = Number(level);
              if (n === 0) chain().setParagraph().run();
              else
                chain()
                  .setHeading({ level: n as 1 | 2 | 3 | 4 | 5 | 6 })
                  .run();
            }}
          />
        </span>
        <span className="rte-sep" aria-hidden="true" />
        <Tool
          label="Bold"
          pressed={state.bold}
          disabled={!rich}
          onRun={() => chain().toggleBold().run()}
        >
          <Glyph text="B" />
        </Tool>
        <Tool
          label="Italic"
          pressed={state.italic}
          disabled={!rich}
          onRun={() => chain().toggleItalic().run()}
        >
          <Glyph text="I" />
        </Tool>
        <Tool
          label="Strikethrough"
          pressed={state.strike}
          disabled={!rich}
          onRun={() => chain().toggleStrike().run()}
        >
          <Glyph text="S" />
        </Tool>
        <Tool
          label="Inline code"
          pressed={state.code}
          disabled={!rich}
          onRun={() => chain().toggleCode().run()}
        >
          <Glyph d={ICON.code} />
        </Tool>
        <span className="rte-sep" aria-hidden="true" />
        <Tool
          label="Bulleted list"
          pressed={state.bullet}
          disabled={!rich}
          onRun={() => chain().toggleBulletList().run()}
        >
          <Glyph d={ICON.bullet} />
        </Tool>
        <Tool
          label="Numbered list"
          pressed={state.ordered}
          disabled={!rich}
          onRun={() => chain().toggleOrderedList().run()}
        >
          <Glyph d={ICON.ordered} />
        </Tool>
        <Tool
          label="Checklist"
          pressed={state.task}
          disabled={!rich}
          onRun={() => chain().toggleTaskList().run()}
        >
          <Glyph d={ICON.task} />
        </Tool>
        <Tool
          label="Quote"
          pressed={state.quote}
          disabled={!rich}
          onRun={() => chain().toggleBlockquote().run()}
        >
          <Glyph d={ICON.quote} />
        </Tool>
        <Tool
          label="Code block"
          pressed={state.codeBlock}
          disabled={!rich}
          onRun={() => chain().toggleCodeBlock().run()}
        >
          <Glyph d={ICON.codeBlock} />
        </Tool>
        <span className="rte-sep" aria-hidden="true" />
        <Tool
          label="Link"
          pressed={state.link}
          disabled={!rich}
          onRun={() => {
            const href: unknown = editor.getAttributes('link').href;
            setPicker(
              picker?.kind === 'link'
                ? null
                : { kind: 'link', href: typeof href === 'string' ? href : '' },
            );
          }}
        >
          <Glyph d={ICON.link} />
        </Tool>
        <Tool
          label="Table"
          disabled={!rich || state.table}
          onRun={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        >
          <Glyph d={ICON.table} />
        </Tool>
        <Tool
          label="Mention someone"
          disabled={!rich || people.length === 0}
          onRun={() => {
            const before = editor.state.selection.$from.nodeBefore?.text ?? '';
            chain()
              .insertContent(before === '' || /\s$/.test(before) ? '@' : ' @')
              .run();
          }}
        >
          <Glyph text="@" />
        </Tool>
        <Tool
          label="Link a card"
          disabled={!rich || cards.length === 0}
          onRun={() => {
            setPicker(picker?.kind === 'card' ? null : { kind: 'card', query: '', active: 0 });
          }}
        >
          <Glyph d={ICON.card} />
        </Tool>
        <span className="rte-sep" aria-hidden="true" />
        <Tool label="Undo" disabled={!rich || !state.canUndo} onRun={() => chain().undo().run()}>
          <Glyph d={ICON.undo} />
        </Tool>
        <Tool label="Redo" disabled={!rich || !state.canRedo} onRun={() => chain().redo().run()}>
          <Glyph d={ICON.redo} />
        </Tool>
        <span className="rte-grow" />
        <Tool label="Markdown" pressed={mode === 'source'} onRun={toggleSource}>
          <Glyph text="M↓" />
        </Tool>
      </div>

      {rich && state.table && (
        <div className="rte-table-tools" role="group" aria-label="Table">
          <Tool label="Add row above" onRun={() => chain().addRowBefore().run()}>
            <Glyph text="+ Row ↑" />
          </Tool>
          <Tool label="Add row below" onRun={() => chain().addRowAfter().run()}>
            <Glyph text="+ Row ↓" />
          </Tool>
          <Tool label="Add column before" onRun={() => chain().addColumnBefore().run()}>
            <Glyph text="+ Col ←" />
          </Tool>
          <Tool label="Add column after" onRun={() => chain().addColumnAfter().run()}>
            <Glyph text="+ Col →" />
          </Tool>
          <Tool label="Delete row" onRun={() => chain().deleteRow().run()}>
            <Glyph text="− Row" />
          </Tool>
          <Tool label="Delete column" onRun={() => chain().deleteColumn().run()}>
            <Glyph text="− Col" />
          </Tool>
          <Tool label="Delete table" onRun={() => chain().deleteTable().run()}>
            <Glyph text="Delete table" />
          </Tool>
        </div>
      )}

      {picker?.kind === 'link' && (
        <form
          className="rte-popover rte-link"
          onSubmit={(event) => {
            event.preventDefault();
            applyLink(picker.href);
          }}
        >
          <input
            className="rte-input"
            aria-label="Link address"
            placeholder="https://"
            value={picker.href}
            // A popover opened to type into.
            autoFocus
            onChange={(event) => {
              setPicker({ kind: 'link', href: event.target.value });
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setPicker(null);
                editor.commands.focus();
              }
            }}
          />
          <Button type="submit">Apply</Button>
          {state.link && (
            <Button
              variant="secondary"
              onClick={() => {
                chain().extendMarkRange('link').unsetLink().run();
                setPicker(null);
              }}
            >
              Remove link
            </Button>
          )}
          {picker.error !== undefined && (
            <p className="rte-popover-error" role="alert">
              {picker.error}
            </p>
          )}
        </form>
      )}

      {picker?.kind === 'card' && (
        <div className="rte-popover rte-cards">
          <input
            className="rte-input"
            role="combobox"
            aria-label="Find a card by key or title"
            aria-expanded="true"
            aria-controls="rte-card-list"
            placeholder="LAI-123 or words from the title"
            value={picker.query}
            // A popover opened to type into.
            autoFocus
            onChange={(event) => {
              setPicker({ kind: 'card', query: event.target.value, active: 0 });
            }}
            onKeyDown={(event) => {
              const n = cardMatches.length;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (n > 0) {
                  const step = event.key === 'ArrowDown' ? 1 : -1;
                  setPicker({ ...picker, active: (picker.active + step + n) % n });
                }
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const card = cardMatches[picker.active];
                if (card !== undefined) insertCard(card);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                setPicker(null);
                editor.commands.focus();
              }
            }}
          />
          <div className="rich-editor-picker" role="listbox" id="rte-card-list" aria-label="Cards">
            {cardMatches.length === 0 ? (
              <p className="rich-editor-picker-empty">No card matches that.</p>
            ) : (
              cardMatches.map((card, i) => (
                <div
                  key={card.id}
                  role="option"
                  aria-selected={i === picker.active}
                  className="rich-editor-picker-option"
                  onMouseDown={(event) => {
                    event.preventDefault();
                  }}
                  onClick={() => {
                    insertCard(card);
                  }}
                >
                  <span className="rich-editor-picker-key">{card.key}</span>{' '}
                  <span className="rich-editor-picker-name">{card.title}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {notice !== undefined && mode === 'source' && (
        <p className="rich-editor-notice" role="status">
          <strong>Opened as Markdown</strong>, so nothing you do not touch changes. {notice}
        </p>
      )}

      <div className="rte-body">
        <EditorContent editor={editor} className="rte-content" hidden={!rich} />
        {!rich && (
          <textarea
            ref={sourceField}
            className="rich-editor-source"
            aria-label={`${label}, as Markdown`}
            value={source}
            spellCheck
            rows={Math.min(24, Math.max(compact ? 3 : 8, source.split('\n').length + 1))}
            onChange={(event) => {
              setSource(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                requestCancel();
              } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        )}

        {picker?.kind === 'mention' && mentionMatches.length > 0 && (
          <div
            className="rich-editor-picker rte-mentions"
            role="listbox"
            aria-label="People"
            style={{ top: picker.top, left: picker.left }}
          >
            {mentionMatches.map((person, i) => (
              <div
                key={person.id}
                role="option"
                aria-selected={i === picker.active}
                className="rich-editor-picker-option"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                onClick={() => {
                  insertMention(person, picker);
                }}
              >
                <span className="rich-editor-picker-name">{person.name}</span>{' '}
                <span className="rich-editor-picker-meta">
                  {person.handle === null ? '' : `@${person.handle}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {error !== undefined && (
        <p className="rich-editor-error" role="alert">
          {error}
        </p>
      )}

      {confirming ? (
        <div className="rich-editor-confirm" role="alertdialog" aria-label="Discard your changes?">
          <p>Discard your changes?</p>
          <Button variant="danger" onClick={onClose}>
            Discard changes
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setConfirming(false);
              // At once, not on the next frame as `commands.focus()` does: the
              // next key pressed belongs to the editor, not to a removed button.
              if (rich) editor.view.focus();
              else sourceField.current?.focus();
            }}
          >
            Keep editing
          </Button>
        </div>
      ) : (
        <div className="rich-editor-actions">
          <Button busy={busy} disabled={compact && empty} onClick={() => void submit()}>
            {submitLabel}
          </Button>
          {!(compact && empty) && (
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          )}
          <span className="rich-editor-hint">
            ⌘↵ to {submitLabel.toLowerCase()} · Esc to cancel
          </span>
        </div>
      )}
    </div>
  );
}
