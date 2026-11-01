import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useShell } from '../shell/shell-context.ts';
import { spaceSettingsHref } from '../../routes/space-settings-url.ts';

/**
 * The space's `⋯` (D-103, LAI-977): the prototype's button, now that there is
 * a page behind it. One item, *Space settings* — a link, so middle-click and
 * copy-link work — open to every reader of the space: the page itself shows a
 * reader the values and withholds the controls.
 *
 * Portalled, as View settings is: the bar is sticky, and a popover inside it
 * is clipped by it and fights it for clicks.
 */
export function SpaceMenu({ slug }: { readonly slug: string }) {
  const {
    route: { navigate },
  } = useShell();
  const trigger = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLAnchorElement>(null);
  const [at, setAt] = useState<{ readonly top: number; readonly right: number } | undefined>();
  const href = spaceSettingsHref(slug);

  useEffect(() => {
    if (at === undefined) return;
    item.current?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setAt(undefined);
      trigger.current?.focus();
    };
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('keydown', onKey);
    };
  }, [at]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="space-chip space-menu-trigger"
        aria-label="Space menu"
        aria-haspopup="menu"
        aria-expanded={at !== undefined}
        onClick={() => {
          if (at !== undefined) {
            setAt(undefined);
            return;
          }
          const box = trigger.current?.getBoundingClientRect();
          if (box === undefined) return;
          setAt({ top: box.bottom + 6, right: Math.max(8, window.innerWidth - box.right) });
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {at !== undefined &&
        createPortal(
          <>
            <div
              className="space-menu-catcher"
              aria-hidden="true"
              onClick={() => {
                setAt(undefined);
              }}
            />
            <ul
              className="space-menu"
              role="menu"
              aria-label="Space menu"
              style={{ top: `${String(at.top)}px`, right: `${String(at.right)}px` }}
            >
              <li role="none">
                <a
                  ref={item}
                  role="menuitem"
                  className="space-menu-item"
                  href={href}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    setAt(undefined);
                    navigate(href);
                  }}
                >
                  Space settings
                </a>
              </li>
            </ul>
          </>,
          document.body,
        )}
    </>
  );
}
