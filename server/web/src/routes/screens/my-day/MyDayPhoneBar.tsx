import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * The phone's top bar on My day (the owner's `MyDay.dc.html`, LAI-518): 48px,
 * ☰, the mark and *Laika*, then the eye, the Viewing switch and the avatar.
 * The bar is the shell's element and holds only ☰ when signed in, so what My
 * day adds is portalled into it and the bar is marked while it holds it
 * (`phone.css` sizes it by the mark); leaving the screen removes both.
 */
export function MyDayPhoneBar({ children }: { readonly children: ReactNode }) {
  const [head, setHead] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.shell-head');
    if (el === null) return;
    el.setAttribute('data-myday-bar', '');
    setHead(el);
    return () => {
      el.removeAttribute('data-myday-bar');
      setHead(null);
    };
  }, []);
  if (head === null) return null;
  return createPortal(
    <div className="myday-bar" data-myday-bar-items>
      <span className="myday-bar-brand">
        <span className="myday-bar-mark" aria-hidden="true">
          <span />
        </span>
        <span className="myday-bar-name">Laika</span>
      </span>
      {children}
    </div>,
    head,
  );
}
