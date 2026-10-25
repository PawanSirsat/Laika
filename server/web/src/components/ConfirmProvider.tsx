import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { ConfirmDialog, type ConfirmIcon } from './ConfirmDialog.tsx';

/** What a screen asks: the dialog's words, and whether the action takes something away. */
export interface ConfirmOptions {
  readonly title: string;
  readonly body: ReactNode;
  readonly confirmLabel: string;
  readonly cancelLabel?: string | undefined;
  readonly danger?: boolean | undefined;
  readonly icon?: ConfirmIcon | undefined;
  readonly detail?: ReactNode;
}

/** Ask, and hear the answer: true for the action, false for Cancel, Escape or the backdrop. */
export type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | undefined>(undefined);

/**
 * The app's one yes-or-no (LAI-522): a screen awaits `useConfirm()` where it
 * once called `window.confirm`, and this draws the dialog. A second question
 * asked while one is open answers the first with no.
 */
export function ConfirmProvider({ children }: { readonly children: ReactNode }) {
  const [asking, setAsking] = useState<
    { readonly options: ConfirmOptions; readonly answer: (yes: boolean) => void } | undefined
  >(undefined);

  const confirm = useCallback<Confirm>(
    (options) =>
      new Promise<boolean>((answer) => {
        setAsking((open) => {
          open?.answer(false);
          return { options, answer };
        });
      }),
    [],
  );

  const settle = (yes: boolean): void => {
    asking?.answer(yes);
    setAsking(undefined);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {asking !== undefined && (
        <ConfirmDialog
          title={asking.options.title}
          confirmLabel={asking.options.confirmLabel}
          cancelLabel={asking.options.cancelLabel}
          danger={asking.options.danger}
          icon={asking.options.icon}
          detail={asking.options.detail}
          onConfirm={() => {
            settle(true);
          }}
          onClose={() => {
            settle(false);
          }}
        >
          {asking.options.body}
        </ConfirmDialog>
      )}
    </ConfirmContext.Provider>
  );
}

/** The app's yes-or-no; only under `ConfirmProvider`, which the app mounts at its root. */
export function useConfirm(): Confirm {
  const confirm = useContext(ConfirmContext);
  if (confirm === undefined) {
    throw new Error('useConfirm needs ConfirmProvider above it (App.tsx mounts it)');
  }
  return confirm;
}
