import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../../../components/forms/Button.tsx';
import { useDialogFocus } from '../../../components/use-dialog-focus.ts';
import { CopyButton } from '../../../components/CopyButton.tsx';
import { Dropdown } from '../../../components/Dropdown.tsx';
import {
  createInvite,
  INVITE_EXPIRY_DAYS,
  type InviteExpiryDays,
  type OrgRole,
  type ProjectRole,
} from '../../../api/invites.ts';
import { projectRoleLabel } from '../../../api/members.ts';
import type { Project } from '../../../api/projects.ts';
import { orgRoleLabel } from '../invite-roles.ts';
import { inviteButtonLabel, parseEmails, rejectedEmails, spaceRolesFor } from './people-derive.ts';

export interface InviteDialogProps {
  /** Where the invite is to: the organisation's name. */
  readonly orgName: string;
  /** The roles this reader may invite as — never Owner; an admin only Member or Viewer (LAI-958). */
  readonly roles: readonly OrgRole[];
  /** Spaces an invite may also bring them into (LAI-984); none hides the picker. */
  readonly projects?: readonly Project[];
  /** What the search box held, when the dialog opened from an empty search. */
  readonly initialText?: string;
  readonly onClose: () => void;
  /** Called once anything was issued, so the pending list is read again. */
  readonly onIssued: () => void;
  /** Where focus goes when it closes — the control that opened it. */
  readonly restore?: () => HTMLElement | null | undefined;
}

/** One line of a send: its link, or the server's refusal for that address (LAI-999). */
type Issued =
  | { readonly email: string | null; readonly url: string; readonly emailed: boolean }
  | { readonly email: string | null; readonly error: string };

/** The server's default lifetime; sent only when another is chosen. */
const DEFAULT_EXPIRY: InviteExpiryDays = 7;

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
  projects = [],
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
  const [space, setSpace] = useState('');
  const [spaceRole, setSpaceRole] = useState<ProjectRole>('member');
  const [expiry, setExpiry] = useState<InviteExpiryDays>(DEFAULT_EXPIRY);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<readonly Issued[] | undefined>(undefined);
  const emails = parseEmails(text);
  const rejected = rejectedEmails(text);
  const spaceRoles = spaceRolesFor(role);
  const intoRole = spaceRoles.includes(spaceRole) ? spaceRole : (spaceRoles[0] ?? 'viewer');

  const send = (): void => {
    if (busy || rejected.length > 0) return;
    setBusy(true);
    const targets: (string | null)[] = emails.length === 0 ? [null] : emails;
    const extra = {
      ...(space === '' ? {} : { project_id: space, project_role: intoRole }),
      ...(expiry === DEFAULT_EXPIRY ? {} : { expires_in_days: expiry }),
    };
    void (async () => {
      const made: Issued[] = [];
      // One at a time, in order, and **each its own answer** (LAI-987): an
      // address already invited must not cost the links for the rest.
      for (const email of targets) {
        try {
          const created = await createInvite({ email, org_role: role, ...extra });
          made.push({
            email: created.invite.email,
            url: created.accept_url,
            emailed: created.invite.email_sent,
          });
        } catch (cause: unknown) {
          made.push({
            email,
            error: cause instanceof Error ? cause.message : 'That invite was refused.',
          });
        }
      }
      setIssued(made);
      if (made.some((i) => 'url' in i)) onIssued();
      setBusy(false);
    })();
  };

  const links = issued?.filter((i): i is Extract<Issued, { url: string }> => 'url' in i) ?? [];

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
            issued === undefined &&
            rejected.length === 0
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
              {rejected.length > 0 && (
                <p className="org-error org-invite-rejected" role="alert" data-invite-rejected>
                  Not an email address: {rejected.join(', ')}
                </p>
              )}
              {projects.length > 0 && (
                <div className="org-dialog-row">
                  <span className="org-dialog-label" id="org-invite-space">
                    Space
                  </span>
                  <Dropdown
                    className="org-invite-space"
                    aria-labelledby="org-invite-space"
                    noun="spaces"
                    searchable={projects.length > 8}
                    value={space}
                    disabled={busy}
                    onChange={setSpace}
                    options={[
                      { value: '', label: 'No space' },
                      ...projects.map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />
                  {space !== '' && (
                    <Dropdown
                      className="org-invite-space-role"
                      aria-label="Space role"
                      noun="roles"
                      value={intoRole}
                      disabled={busy || spaceRoles.length === 1}
                      onChange={setSpaceRole}
                      options={spaceRoles.map((r) => ({
                        value: r,
                        label: r === 'lead' ? 'Space admin' : projectRoleLabel(r),
                      }))}
                    />
                  )}
                </div>
              )}
              <div className="org-dialog-row">
                <span className="org-dialog-label" id="org-invite-expiry">
                  Expires
                </span>
                <div className="org-segmented" role="group" aria-labelledby="org-invite-expiry">
                  {INVITE_EXPIRY_DAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className="org-segment"
                      data-invite-expiry={d}
                      aria-pressed={expiry === d}
                      disabled={busy}
                      onClick={() => {
                        setExpiry(d);
                      }}
                    >
                      {d === 1 ? '1 day' : `${String(d)} days`}
                    </button>
                  ))}
                </div>
              </div>
              <p className="org-dialog-note">
                Laika sends no email: each link is shown once, to send yourself.
              </p>
            </div>
            <footer className="org-dialog-foot">
              <Button variant="secondary" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button busy={busy} disabled={rejected.length > 0} onClick={send} data-invite-send>
                {inviteButtonLabel(emails.length)}
              </Button>
            </footer>
          </>
        ) : (
          <>
            <div className="org-dialog-body" role="status">
              <p className="org-issued-head">
                {issued.length === 1
                  ? 'url' in (issued[0] ?? {})
                    ? issued[0]?.email === null
                      ? 'Invite link created'
                      : `Invite created for ${issued[0]?.email ?? ''}`
                    : 'The invite was refused'
                  : `${String(links.length)} of ${String(issued.length)} invites created`}
              </p>
              {links.length > 0 && (
                <p className="org-issued-body">
                  {links.every((i) => i.emailed)
                    ? 'Each link is shown once — the server stores only a hash of it.'
                    : 'Nothing was emailed: send each link yourself. It is shown once — the server stores only a hash of it. If it is lost, Re-issue it from Pending.'}
                </p>
              )}
              <ul className="org-issued-list">
                {issued.map((i, index) => (
                  <li
                    key={'url' in i ? i.url : `refused-${String(index)}`}
                    data-issued-ok={'url' in i}
                  >
                    {i.email !== null && <span className="org-issued-to">{i.email}</span>}
                    {'url' in i ? (
                      <>
                        <code className="org-issued-url">{i.url}</code>
                        <CopyButton
                          text={i.url}
                          label="Copy link"
                          what={`the invite link for ${i.email ?? 'anyone'}`}
                        />
                      </>
                    ) : (
                      <span className="org-issued-error">{i.error}</span>
                    )}
                  </li>
                ))}
              </ul>
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
