import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react';
import { Spinner } from '../../../components/Spinner.tsx';
import { Button } from '../../../components/forms/Button.tsx';

/**
 * The task editor, loaded the first time somebody edits (LAI-827).
 *
 * TipTap and ProseMirror are most of the editor's weight, and the Board and the
 * List never need them: they read. So the editor is its own chunk, fetched by
 * `import()` when a description, an acceptance or a comment is opened for
 * editing — and this file, which the panel imports, holds only its props and
 * the boundary. **Nothing here imports the editor's modules by value**: a type
 * import is erased, a value import would pull the whole chunk into the board.
 */

/** Somebody who may be `@`-mentioned, and the handle the server resolves. */
export interface MentionCandidate {
  readonly id: string;
  readonly name: string;
  /**
   * The email local part — what `@` resolves on the server (§4.19). `null`
   * when the reader cannot see it: then the name is written, as before.
   */
  readonly handle: string | null;
}

/** A card the editor can link to, by key. */
export interface CardCandidate {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly href: string;
}

export interface RichEditorProps {
  /** The markdown at the moment editing opened. */
  readonly value: string;
  /** The field's name, for the accessible label: `Description`. */
  readonly label: string;
  readonly placeholder: string;
  /** `Save` for a document, `Comment` for the composer. */
  readonly submitLabel: string;
  /**
   * Called only when something changed. Rejects to keep the editor open with
   * the reason — an `ApiError`'s message is shown as it is.
   */
  readonly onSubmit: (markdown: string) => Promise<void>;
  /** Cancel, or a submit with nothing changed: nothing is sent. */
  readonly onClose: () => void;
  readonly people: readonly MentionCandidate[];
  readonly cards: readonly CardCandidate[];
  /** The composer's shape: no Cancel when empty, one line at rest. */
  readonly compact?: boolean;
  /**
   * Where the reading view was clicked, from the top left of its text: the
   * caret goes there, as Jira's does, rather than to the end of a long
   * document — which would also scroll the page away from where the person
   * was looking.
   */
  readonly caretAt?: { readonly x: number; readonly y: number } | undefined;
  /**
   * What stands in the editor's place while its chunk loads: the text it is
   * replacing, so the panel does not collapse to a one-line *Opening…* box
   * and spring back when the editor arrives.
   */
  readonly holding?: ReactNode;
}

const Editor = lazy(async () => {
  const loaded = await import('./editor/RichEditor.tsx');
  return { default: loaded.RichEditor };
});

interface BoundaryProps {
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** A chunk that fails to load (offline, a deploy in between) says so, not a blank panel. */
class LoadFailure extends Component<BoundaryProps, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('The task editor could not load', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="rich-editor-failed" role="alert">
        <p>The editor could not load. Check the connection and open it again.</p>
        <Button variant="secondary" onClick={this.props.onClose}>
          Close
        </Button>
      </div>
    );
  }
}

export function LazyRichEditor(props: RichEditorProps) {
  return (
    <LoadFailure onClose={props.onClose}>
      <Suspense
        fallback={
          props.holding === undefined ? (
            <div className="rich-editor-loading" role="status">
              <Spinner size="sm" label={`Opening the ${props.label.toLowerCase()} editor`} />
              Opening the editor…
            </div>
          ) : (
            <div className="rich-editor-loading rich-editor-holding" role="status" aria-busy="true">
              <span className="visually-hidden">
                Opening the {props.label.toLowerCase()} editor
              </span>
              {props.holding}
            </div>
          )
        }
      >
        <Editor {...props} />
      </Suspense>
    </LoadFailure>
  );
}
