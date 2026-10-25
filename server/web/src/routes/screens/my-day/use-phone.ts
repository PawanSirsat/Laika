import { useEffect, useState } from 'react';

/**
 * Where My day is the owner's phone page (LAI-518): the width at which the
 * shell's sidebar goes off-canvas (`app-shell.css`) and the drawer becomes a
 * sheet (`MyDayDrawer.tsx`'s `SHEET_QUERY`, the same value).
 */
export const PHONE_QUERY = '(max-width: 900px)';

/** Whether the window is a phone's, kept live as it is resized. */
export function usePhone(): boolean {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const list = window.matchMedia(PHONE_QUERY);
    const onChange = (): void => {
      setPhone(list.matches);
    };
    onChange();
    list.addEventListener('change', onChange);
    return () => {
      list.removeEventListener('change', onChange);
    };
  }, []);
  return phone;
}
