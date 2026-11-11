import { useCallback, useEffect, useRef, useState } from 'react';
import type { Validity } from './validation.ts';

/**
 * When a field shows its client-side complaint, and where focus goes when the
 * form is refused (LAI-1203).
 *
 * - **On blur**, once the reader has typed something into the field. Tabbing
 *   past an empty field says nothing: a required error for a field the reader
 *   has not reached yet is noise, and submit still catches it.
 * - **On submit**, for every field at once, and focus moves to the first
 *   invalid one in the order the form draws them.
 * - **After the server answers**, the same: the first field the server named,
 *   or the summary when it named none, so a keyboard user is never left on a
 *   button that just went disabled and back.
 *
 * "First invalid" is read from the DOM — the first `aria-invalid="true"`
 * inside the form — rather than from a list of names, so the order can never
 * drift from what is on screen, and a server error mapped to a field counts the
 * same as a client one.
 */
export function useValidatedForm<T extends HTMLElement = HTMLFormElement>() {
  const formRef = useRef<T>(null);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const [focusAsk, setFocusAsk] = useState(0);

  useEffect(() => {
    if (focusAsk === 0) return;
    const form = formRef.current;
    if (form === null) return;
    const target =
      form.querySelector<HTMLElement>('[aria-invalid="true"]') ??
      form.querySelector<HTMLElement>('[data-auth-summary]:not(:empty)');
    target?.focus();
  }, [focusAsk]);

  /** Wire to a field's `onBlur`. */
  const blur = useCallback((name: string, value: string) => {
    if (value === '') return;
    setTouched((prev) => (prev.has(name) ? prev : new Set(prev).add(name)));
  }, []);

  /** The message to show under a field, or `undefined` while it is quiet. */
  const shown = (name: string, check: Validity): string | undefined =>
    (submitted || touched.has(name)) && !check.ok ? check.message : undefined;

  /** Call from `onSubmit`. Returns whether to send. */
  const attempt = (valid: boolean): boolean => {
    setSubmitted(true);
    if (!valid) setFocusAsk((n) => n + 1);
    return valid;
  };

  /** Move focus to the first invalid field, or the summary, after this render. */
  const focusFirstInvalid = useCallback(() => {
    setFocusAsk((n) => n + 1);
  }, []);

  return { formRef, blur, shown, attempt, focusFirstInvalid };
}

/**
 * Re-focus whenever the server's answer changes to something worth reading.
 *
 * Keyed on the **content** of the answer, not its identity: a caller that
 * defaults `fieldErrors = {}` makes a new object every render, and an effect on
 * that would steal focus on every keystroke.
 */
export function useFocusOnServerAnswer(
  focusFirstInvalid: () => void,
  answer: {
    readonly rejected?: boolean | undefined;
    readonly serverError?: string | undefined;
    readonly fieldErrors?: Readonly<Record<string, string>> | undefined;
  },
): void {
  const key = [
    answer.rejected === true ? 'rejected' : '',
    answer.serverError ?? '',
    JSON.stringify(answer.fieldErrors ?? {}),
  ].join('\u0000');
  const empty = ['', '', '{}'].join('\u0000');

  useEffect(() => {
    if (key !== empty) focusFirstInvalid();
  }, [key, empty, focusFirstInvalid]);
}
