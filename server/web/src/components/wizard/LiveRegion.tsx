/**
 * The polite live region `useLiveRegion` writes into (LAI-1048). Visually
 * hidden; mount it with the screen, empty, so the first message is heard.
 */
export function LiveRegion({ message }: { readonly message: string }) {
  return (
    <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}
