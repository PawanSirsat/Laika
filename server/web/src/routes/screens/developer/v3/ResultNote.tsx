import { useCallback, useState } from 'react';
import './page-notices.css';

export interface ResultNoteProps {
  readonly message: string;
  readonly onDismiss: () => void;
}

/**
 * What a write just did — a device disconnected, a credential revoked — in
 * words a sighted reader sees (LAI-1197). Screen readers hear it through the
 * page's live region, which is mounted empty with the page and so is heard
 * reliably; this note carries no live role of its own, so nothing is
 * announced twice.
 */
export function ResultNote({ message, onDismiss }: ResultNoteProps) {
  return (
    <div className="dx-note dx-result" data-tone="accent" data-result="">
      <p className="dx-result-text">{message}</p>
      <button
        type="button"
        className="dx-btn dx-btn-sm dx-btn-ghost"
        aria-label={`Dismiss: ${message}`}
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * The page's last result: `show` puts a message on screen and hands it to
 * `announce` for screen readers; `clear` takes it away.
 */
export function useResult(announce: (message: string) => void) {
  const [result, setResult] = useState<string | undefined>(undefined);
  const show = useCallback(
    (message: string): void => {
      announce(message);
      setResult(message);
    },
    [announce],
  );
  const clear = useCallback((): void => {
    setResult(undefined);
  }, []);
  return [result, show, clear] as const;
}
