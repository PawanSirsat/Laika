import { useEffect, useRef, type RefObject } from 'react';

/**
 * Focus a form-only page's first field once (LAI-1141): as soon as it can
 * take focus. Not the `autoFocus` attribute — Sign in mounts its fields
 * disabled while the session is read, a disabled field cannot be focused,
 * and `autoFocus` does not try again when it is enabled. Once only, so a
 * field that is disabled again during a submit does not pull focus back.
 */
export function useFirstFocus(
  ref: RefObject<HTMLInputElement | null>,
  wanted: boolean,
  disabled: boolean,
): void {
  const done = useRef(false);
  useEffect(() => {
    if (!wanted || disabled || done.current) return;
    const field = ref.current;
    if (field === null) return;
    done.current = true;
    field.focus();
  }, [ref, wanted, disabled]);
}
