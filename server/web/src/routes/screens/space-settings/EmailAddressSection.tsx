import { useEffect, useState } from 'react';
import {
  getProjectEmailAddress,
  inboundRefusal,
  isNotForYou,
  type ProjectEmailAddress,
  rotateProjectEmailAddress,
} from '../../../api/email-inbound.ts';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { useConfirm } from '../../../components/ConfirmProvider.tsx';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { LoadingState } from '../../../components/LoadingState.tsx';

export interface EmailAddressSectionProps {
  readonly slug: string;
}

type Read =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly error: unknown }
  | { readonly kind: 'ready'; readonly view: ProjectEmailAddress };

/**
 * The space's own address on Settings → General (D-155, LAI-1315), for
 * anyone who may create a task here — mailing it is creating one.
 *
 * **Drawn only for that reader**: the screen asks only when the gate says
 * `task.create`, and a `403` or `404` all the same draws nothing, so a
 * reader who may not mail the space is never shown where to.
 *
 * *New address* is for whoever may edit the space's settings
 * (`can_rotate`): the old address stops at once, so it asks first.
 */
export function EmailAddressSection({ slug }: EmailAddressSectionProps) {
  const confirm = useConfirm();
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [rotated, setRotated] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setRead({ kind: 'loading' });
    getProjectEmailAddress(slug, controller.signal)
      .then((view) => {
        setRead({ kind: 'ready', view });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setRead({ kind: 'error', error: cause });
      });
    return () => {
      controller.abort();
    };
  }, [slug, attempt]);

  if (read.kind === 'error' && isNotForYou(read.error)) return null;

  const rotate = (): void => {
    void confirm({
      title: 'Make a new address for this space?',
      body: 'The old address stops working at once. Mail sent to it from now on is dropped, so tell everyone who uses it.',
      confirmLabel: 'New address',
      danger: true,
    }).then((yes) => {
      if (!yes) return;
      setBusy(true);
      setError(undefined);
      setRotated(false);
      rotateProjectEmailAddress(slug)
        .then((view) => {
          setRead({ kind: 'ready', view });
          setRotated(true);
        })
        .catch((cause: unknown) => {
          setError(inboundRefusal(cause));
        })
        .finally(() => {
          setBusy(false);
        });
    });
  };

  return (
    <section
      className="ss-card ss-email-in"
      aria-labelledby="ss-email-in-title"
      data-email-address-section
    >
      <header className="ss-card-head">
        <h2 id="ss-email-in-title">Email to this space</h2>
        <p>
          Mail from a member to this address becomes a task in this space, written as them; replies
          in the thread become comments.
        </p>
      </header>
      <div className="ss-email-in-body">
        {read.kind === 'loading' && (
          <LoadingState shape="row" count={1} label="Loading this space’s address" />
        )}
        {read.kind === 'error' && (
          <ApiErrorState
            error={read.error}
            resource="this space’s address"
            onRetry={() => {
              setAttempt((n) => n + 1);
            }}
          />
        )}
        {read.kind === 'ready' && (
          <>
            {!read.view.enabled && (
              <p className="ss-notice" data-email-off>
                Email to tasks is off for this organisation. Mail to this address is recorded and
                dropped.
              </p>
            )}
            {read.view.address === null ? (
              <p className="ss-help" data-email-address="none">
                Your organisation has not set a receiving domain yet.
              </p>
            ) : (
              <div className="ss-email-in-address" data-email-address="set">
                <code className="ss-email-in-code">{read.view.address}</code>
                <span className="ss-email-in-actions">
                  <CopyButton text={read.view.address} what="this space’s address" />
                  {read.view.can_rotate && (
                    <Button
                      variant="secondary"
                      size="sm"
                      busy={busy}
                      onClick={rotate}
                      data-email-rotate
                    >
                      New address
                    </Button>
                  )}
                </span>
              </div>
            )}
            {rotated && (
              <p className="ss-help" role="status" data-email-rotated>
                New address made. The old one no longer works.
              </p>
            )}
            {error !== undefined && (
              <p className="ss-field-error" role="alert" data-error="email-address">
                {error}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
