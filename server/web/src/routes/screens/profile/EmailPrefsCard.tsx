import { useEffect, useState } from 'react';
import { type EmailPrefs, getEmailPrefs, saveEmailPrefs } from '../../../api/email.ts';
import { getOrg } from '../../../api/org.ts';
import { Switch } from '../../../components/Switch.tsx';
import { emailOn } from '../organisation/email-derive.ts';

/**
 * Your own email switches (§11.4.2.1, D-153, LAI-1313), on your own profile
 * only: instant mail when you are assigned or @mentioned, and the daily digest.
 * Each switch saves as it flips.
 *
 * While the organisation's email is off nothing is mailed whatever these say,
 * and the card says so in one line rather than letting a switch look like it
 * does something it cannot yet.
 *
 * Draws nothing until both reads answer, and nothing if either fails — a
 * preference you cannot see is better than one that reads wrong.
 */
export function EmailPrefsCard() {
  const [prefs, setPrefs] = useState<EmailPrefs | undefined>(undefined);
  const [orgOn, setOrgOn] = useState<boolean | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([getEmailPrefs(controller.signal), getOrg(controller.signal)])
      .then(([answer, org]) => {
        if (controller.signal.aborted) return;
        setPrefs(answer);
        setOrgOn(emailOn(org));
      })
      .catch(() => {
        // Left undrawn: see the component comment.
      });
    return () => {
      controller.abort();
    };
  }, []);

  if (prefs === undefined || orgOn === undefined) return null;

  const flip = (patch: Partial<EmailPrefs>): void => {
    setBusy(true);
    setError(undefined);
    saveEmailPrefs(patch)
      .then(setPrefs)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'That could not be saved.');
      })
      .finally(() => {
        setBusy(false);
      });
  };

  return (
    <section className="prof-email" aria-labelledby="prof-email-head" data-section="email-prefs">
      <h3 className="prof-email-head" id="prof-email-head">
        Email
      </h3>
      <div className="prof-email-switches">
        <Switch
          checked={prefs.instant}
          disabled={busy}
          onChange={(on) => {
            flip({ instant: on });
          }}
        >
          Email me when I’m assigned or mentioned
        </Switch>
        <Switch
          checked={prefs.digest}
          disabled={busy}
          onChange={(on) => {
            flip({ digest: on });
          }}
        >
          Send me a daily digest of the tasks I watch
        </Switch>
      </div>
      {!orgOn && (
        <p className="prof-email-note" data-email-off>
          Email is off for this organisation, so nothing is sent until an owner or admin turns it
          on. These take effect then.
        </p>
      )}
      {error !== undefined && (
        <p className="prof-email-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
