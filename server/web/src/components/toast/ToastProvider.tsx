import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  EMPTY_QUEUE,
  dismiss as drop,
  expire,
  nextDeadline,
  pause,
  push,
  resume,
  secondsLeft,
  settleUndo,
  startUndo,
  type ToastInput,
  type ToastQueue,
} from './toast-model.ts';
import './toast.css';

/** What a screen may do with the app's toasts. */
export interface ToastApi {
  /** Show one; returns its id. Undo is for changes the server can really reverse. */
  readonly show: (input: ToastInput) => number;
  readonly dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : 'Nothing was undone.';
}

/**
 * The app's one toast (LAI-1129; `docs/ux/architecture/component-architecture.md`
 * §2 *Toast*). Mounted once, in `App.tsx`, so every screen says what happened
 * the same way: `useToast().show({ text, tone, undo })`.
 *
 * - The sentence alone is announced — `role="status"` for info and success,
 *   `role="alert"` for an error — never "Undo ×" read out with it.
 * - **It never takes focus.** It sits last in the tab order; Escape on a
 *   focused toast dismisses it, and focus goes back to where it came from.
 * - Hover or focus anywhere on the stack pauses every timer
 *   (`toast-model.ts`), so a person reaching for Undo is never raced.
 * - Undo runs the screen's real reversing call; the same toast then says the
 *   server's answer, so the focus on it is not lost.
 * - Drawn into `document.body`, above dialogs (`--layer` 90 over the
 *   confirm dialog's 80), bottom-right, bottom-centre below 600 px.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const [queue, setQueue] = useState<ToastQueue>(EMPTY_QUEUE);
  const [now, setNow] = useState(() => Date.now());
  const stack = useRef<HTMLElement | null>(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  /** Where focus was before it entered the stack, to hand it back on dismiss. */
  const returnTo = useRef<HTMLElement | null>(null);
  const closers = useRef(new Map<number, HTMLButtonElement>());

  const holdOrRun = useCallback(() => {
    const at = Date.now();
    setQueue((q) => (hovered.current || focused.current ? pause(q, at) : resume(q, at)));
  }, []);

  // One timer, aimed at the next toast to go.
  useEffect(() => {
    const deadline = nextDeadline(queue);
    if (deadline === undefined) return;
    const timer = setTimeout(
      () => {
        setQueue((q) => expire(q, Date.now()));
      },
      Math.max(0, deadline - Date.now()),
    );
    return () => {
      clearTimeout(timer);
    };
  }, [queue]);

  // The Undo countdown ticks once a second while one is running.
  const counting = queue.items.some((t) => t.undo !== undefined && t.expiresAt !== null);
  useEffect(() => {
    if (!counting) return;
    setNow(Date.now());
    const tick = setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      clearInterval(tick);
    };
  }, [counting]);

  // The stack is gone: nothing can hold the clock any more.
  useEffect(() => {
    if (queue.items.length > 0) return;
    hovered.current = false;
    focused.current = false;
  }, [queue.items.length]);

  const seq = useRef(0);
  const show = useCallback((input: ToastInput): number => {
    seq.current += 1;
    const id = seq.current;
    const at = Date.now();
    setQueue((q) => push(q, input, at, id).queue);
    return id;
  }, []);

  const dismiss = useCallback((id: number): void => {
    setQueue((q) => drop(q, id));
  }, []);

  /** Dismissed from the keyboard or the ×: focus never falls to the page's top. */
  const close = (id: number): void => {
    const inside = stack.current?.contains(document.activeElement) === true;
    const others = queue.items.filter((t) => t.id !== id);
    dismiss(id);
    if (!inside) return;
    const next = others.at(-1);
    const target =
      next === undefined ? returnTo.current : (closers.current.get(next.id) ?? returnTo.current);
    if (next === undefined) {
      focused.current = false;
      holdOrRun();
    }
    if (target?.isConnected === true) target.focus();
  };

  const runUndo = (id: number): void => {
    const item = queue.items.find((t) => t.id === id);
    if (item?.undo === undefined || item.undoing) return;
    const undo = item.undo;
    setQueue((q) => startUndo(q, id, Date.now()));
    const settle = (outcome: { text: string; tone: 'success' | 'error' }): void => {
      const hadFocus = stack.current?.contains(document.activeElement) === true;
      setQueue((q) => settleUndo(q, id, outcome, Date.now()));
      // The Undo button is gone with the answer: keep focus on this toast.
      if (hadFocus) {
        requestAnimationFrame(() => {
          closers.current.get(id)?.focus();
        });
      }
    };
    undo()
      .then((text) => {
        settle({ text, tone: 'success' });
      })
      .catch((cause: unknown) => {
        settle({ text: messageOf(cause), tone: 'error' });
      });
  };

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  const view =
    queue.items.length === 0 ? null : (
      <section
        ref={stack}
        className="toast-stack"
        aria-label="Notifications"
        data-toast-stack
        data-paused={queue.paused ? '' : undefined}
        onMouseEnter={() => {
          hovered.current = true;
          holdOrRun();
        }}
        onMouseLeave={() => {
          hovered.current = false;
          holdOrRun();
        }}
        onFocus={(event) => {
          const from = event.relatedTarget;
          if (
            !focused.current &&
            from instanceof HTMLElement &&
            !event.currentTarget.contains(from)
          ) {
            returnTo.current = from;
          }
          focused.current = true;
          holdOrRun();
        }}
        onBlur={(event) => {
          if (event.currentTarget.contains(event.relatedTarget)) return;
          focused.current = false;
          holdOrRun();
        }}
      >
        {queue.items.map((toast) => {
          const left = toast.undo === undefined ? null : secondsLeft(toast, now);
          return (
            <div
              key={toast.id}
              className={`toast toast-${toast.tone}`}
              data-toast
              data-tone={toast.tone}
              {...(toast.mark === undefined ? {} : { [`data-${toast.mark}`]: '' })}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.stopPropagation();
                close(toast.id);
              }}
            >
              {toast.tone !== 'info' && <span className="toast-dot" aria-hidden="true" />}
              <span className="toast-text" role={toast.tone === 'error' ? 'alert' : 'status'}>
                {toast.text}
              </span>
              {toast.undo !== undefined && (
                <button
                  type="button"
                  className="toast-undo"
                  disabled={toast.undoing}
                  aria-busy={toast.undoing}
                  onClick={() => {
                    runUndo(toast.id);
                  }}
                >
                  {toast.undoing ? 'Undoing…' : 'Undo'}
                  {!toast.undoing && left !== null && (
                    <span className="toast-count" aria-hidden="true" data-toast-count>
                      {left}s
                    </span>
                  )}
                </button>
              )}
              <button
                type="button"
                className="toast-close"
                aria-label="Dismiss"
                ref={(el) => {
                  if (el === null) closers.current.delete(toast.id);
                  else closers.current.set(toast.id, el);
                }}
                onClick={() => {
                  close(toast.id);
                }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
          );
        })}
      </section>
    );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {view !== null && createPortal(view, document.body)}
    </ToastContext.Provider>
  );
}

/** The app's toasts; only under `ToastProvider`, which `App.tsx` mounts at its root. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === undefined) {
    throw new Error('useToast needs ToastProvider above it (App.tsx mounts it)');
  }
  return api;
}
