import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiErrorState } from '../../../components/ApiErrorState.tsx';
import { Button } from '../../../components/forms/Button.tsx';
import { useDialogFocus } from '../../../components/use-dialog-focus.ts';
import { createInvite, type OrgRole } from '../../../api/invites.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { inviteButtonLabel, parseEmails } from './people-derive.ts';

export interface InviteDialogProps {
  /** Where the invite is to: the organisation's name. */
  readonly orgName: string;
  /** The roles this reader may invite as — never Owner; an admin only Member or Viewer (LAI-958). */
  readonly roles: readonly OrgRole[];
  /** What the search box held, when the dialog opened from an empty search. */
  readonly initialText?: string;
  readonly onClose: () => void;
  /** Called once anything was issued, so the pending list is read again. */
  readonly onIssued: () => void;
  /** Where focus goes when it closes — the control that opened it. */
  readonly restore?: () => HTMLElement | null | undefined;
}

interface Issued {
  readonly email: string | null;
  readonly url: string;
  readonly emailed: boolean;
}

/**
 * *Invite people* as the owner's "Laika App v3" design draws it (LAI-893): a
 * modal with the addresses — several, separated by commas, or none for a
 * link — the role as a segment, the expiry note, and a button that says what
 * it will do: *Create link*, *Send invite* or *Send N invites*. One request
 * per address, in order; a link is one request with no address.
 *
 * **The links are shown once.** The server keeps only a hash, so each accept
 * link stays on screen until *Done* — and with no mail configured (LAI-206)
 * nothing was emailed, so the link is the invite.
 */
export function InviteDialog({
  orgName,
  roles,
  initialText = '',
  onClose,
  onIssued,
  restore,
}: InviteDialogProps) {
  const box = useRef<HTMLDivElement | null>(null);
  useDialogFocus(box, { restore });
  const [text, setText] = useState(initialText);
  const [role, setRole] = useState<OrgRole>(
    roles.includes('member') ? 'member' : (roles[0] ?? 'member'),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [issued, setIssued] = useState<readonly Issued[] | undefined>(undefined);
  const emails = parseEmails(text);

  const send = (): void => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const targets: (string | null)[] = emails.length === 0 ? [null] : emails;
    const made: Issued[] = [];
    void (async () => {
      try {
        for (const email of targets) {
          const created = await createInvite({ email, org_role: role });
          made.push({
            email: created.invite.email,
            url: created.accept_url,
            emailed: created.invite.email_sent,
          });
        }
        setIssued(made);
        onIssued();
      } catch (cause: unknown) {
        setError(cause);
        // What was issued before the refusal stands: say so rather than lose the links.
        if (made.length > 0) {
          setIssued(made);
          onIssued();
        }
      } finally {
        setBusy(false);
      }
    })();
  };

  return createPortal(
    <>
      <div className="org-dialog-scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={box}
        className="org-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="org-invite-title"
        data-invite-dialog
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onClose();
          } else if (
            event.key === 'Enter' &&
            (event.metaKey || event.ctrlKey) &&
            issued === undefined
          ) {
            event.preventDefault();
            send();
          }
        }}
      >
        <header className="org-dialog-head">
          <div className="org-dialog-titles">
            <h2 className="org-dialog-title" id="org-invite-title">
              Invite people
            </h2>
            <p className="org-dialog-sub">
              to <span className="org-dialog-org">{orgName}</span>
            </p>
          </div>
          <button type="button" className="org-dialog-close" aria-label="Close" onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>

        {issued === undefined ? (
          <>
            <div className="org-dialog-body">
              <label className="org-dialog-field">
                <span className="org-dialog-label">Emails</span>
                <textarea
                  className="org-invite-emails"
                  data-invite-emails
                  rows={3}
                  value={text}
                  placeholder="Emails, separated by commas — or leave blank for a link"
                  disabled={busy}
                  // Opened by the reader's own click: the field is where focus goes.
                  autoFocus
                  onChange={(event) => {
                    setText(event.target.value);
                  }}
                />
              </label>
              <div className="org-dialog-row">
                <span className="org-dialog-label" id="org-invite-role">
                  Role
                </span>
                <div className="org-segmented" role="group" aria-labelledby="org-invite-role">
                  {roles.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="org-segment"
                      data-invite-role={r}
                      aria-pressed={role === r}
                      disabled={busy}
                      onClick={() => {
                        setRole(r);
                      }}
                    >
                      {orgRoleLabel(r)}
                    </button>
                  ))}
                </div>
              </div>
              <p className="org-dialog-note">
                Invites expire after 7 days. Links expire after 2 days and are not emailed.
              </p>
              {error !== null && (
                <ApiErrorState error={error} resource="this invite" verb="create" />
              )}
            </div>
            <footer className="org-dialog-foot">
              <Button variant="secondary" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button busy={busy} onClick={send} data-invite-send>
                {inviteButtonLabel(emails.length)}
              </Button>
            </footer>
          </>
        ) : (
          <>
            <div className="org-dialog-body" role="status">
              <p className="org-issued-head">
                {issued.length === 1
                  ? issued[0]?.email === null
                    ? 'Invite link created'
                    : `Invite created for ${issued[0]?.email ?? ''}`
                  : `${String(issued.length)} invites created`}
              </p>
              <p className="org-issued-body">
                {issued.every((i) => i.emailed)
                  ? 'Each link is shown once — the server stores only a hash of it.'
                  : 'Nothing was emailed: send each link yourself. It is shown once — the server stores only a hash of it. If it is lost, revoke the invite and create another.'}
              </p>
              <ul className="org-issued-list">
                {issued.map((i) => (
                  <li key={i.url}>
                    {i.email !== null && <span className="org-issued-to">{i.email}</span>}
                    <code className="org-issued-url">{i.url}</code>
                  </li>
                ))}
              </ul>
              {error !== null && (
                <ApiErrorState error={error} resource="the rest of the invites" verb="create" />
              )}
            </div>
            <footer className="org-dialog-foot">
              <Button onClick={onClose} data-invite-done>
                Done
              </Button>
            </footer>
          </>
        )}
      </div>
    </>,
    document.body,
  );
}
