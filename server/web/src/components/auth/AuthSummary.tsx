import type { ReactNode } from 'react';

/**
 * Where a form says what the server refused (LAI-1203).
 *
 * **Always rendered**, empty until there is something to say: a live region
 * created in the same render as its text is often not announced, so the
 * region exists from the first paint and only its content changes.
 * `role="alert"` because a refused submit is what the reader is waiting on.
 *
 * `tabIndex={-1}` so `useValidatedForm` can move focus here when the server's
 * answer names no field — otherwise focus is left on a button that was
 * disabled for the round trip, and a keyboard user has to find their way back.
 */
export function AuthSummary({ children }: { readonly children?: ReactNode }) {
  return (
    <div className="auth-summary" role="alert" tabIndex={-1} data-auth-summary="">
      {children}
    </div>
  );
}

/** One line in the summary: a glyph beside the words, so red is never the only signal. */
export function AuthAlert({ children }: { readonly children: ReactNode }) {
  return (
    <p className="auth-alert">
      <AlertGlyph />
      <span>{children}</span>
    </p>
  );
}

export function AlertGlyph() {
  return (
    <span className="auth-alert-glyph" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="12" cy="16.75" r="1.15" fill="currentColor" />
      </svg>
    </span>
  );
}
