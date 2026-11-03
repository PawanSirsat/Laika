import { useEffect, useId, useState, type ReactNode } from 'react';
import { loadBoardFacts, type BoardFacts } from '../../../../api/developer-compat.ts';
import { CodeBlock } from '../../../../components/wizard/CodeBlock.tsx';
import { CHECKOUT } from './add-flow.ts';
import {
  GUIDE_TITLE,
  LINK_TAIL,
  REHASH_BASH,
  REHASH_ZSH,
  SKIP_ANSWER,
  STEP_TITLES,
  TOO_OLD_ANSWER,
  boardLine,
  guideCommands,
  type GuideStep,
} from './update-cli.ts';
import { ALLOW_HTTP_WHY } from './update-status.ts';
import '../../connect/connect.css';
import './update-cli.css';

/**
 * *Update your Laika CLI* (LAI-1086): the guide itself, and the one-line
 * disclosure that folds it away wherever a screen only needs to point at it.
 * Placed in Project setup's check step too (LAI-1093).
 *
 * The board's build, protocol and oldest accepted helper, and where its
 * helper comes from (`cli.source`, for the fresh install), are read from
 * `GET /developer/compatibility` once per page and only when a guide is
 * first opened, so a screen that folds it away makes no request for it.
 */

let asked: Promise<BoardFacts> | undefined;

/** The board's build and helper source, read once for the page's life. */
function boardFacts(): Promise<BoardFacts> {
  asked ??= loadBoardFacts();
  return asked;
}

/** `'loading'` until the answer is in. */
function useBoardFacts(): BoardFacts | 'loading' {
  const [facts, setFacts] = useState<BoardFacts | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    void boardFacts().then((answer) => {
      if (live) setFacts(answer);
    });
    return () => {
      live = false;
    };
  }, []);
  return facts;
}

function currentOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin;
}

function Step({
  step,
  n,
  children,
}: {
  readonly step: GuideStep;
  readonly n: number;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <li className="dv3-cli-step" data-guide-step={step} aria-labelledby={id}>
      <h4 className="dv3-cli-step-title" id={id}>
        <span className="dv3-cli-step-n" aria-hidden="true">
          {n}
        </span>
        {STEP_TITLES[step]}
      </h4>
      <div className="dv3-cli-step-body">{children}</div>
    </li>
  );
}

export interface UpdateCliGuideProps {
  /** The board's origin; this page's when absent. */
  readonly origin?: string;
  /** Called when the update command was copied — Tool details watch for the new report. */
  readonly onCopiedUpdate?: () => void;
}

/**
 * The four steps, in order: check, update with `laika update`, a fresh
 * install beside a CLI too old for it, and what to do after. `--allow-http`
 * appears only when this board is plain http off loopback, exactly as Tool
 * details' own update command does (`updateCommand`).
 */
export function UpdateCliGuide({ origin, onCopiedUpdate }: UpdateCliGuideProps) {
  const ids = useId();
  const facts = useBoardFacts();
  const loading = facts === 'loading';
  const commands = guideCommands(origin ?? currentOrigin(), loading ? undefined : facts.source);
  return (
    <div className="dv3-cli-guide" data-update-cli-guide="">
      <p className="dv3-cli-board" data-board-build={loading ? 'loading' : ''}>
        {loading ? 'Reading which build this board runs…' : boardLine(facts.build)}
      </p>
      <ol className="dv3-cli-steps">
        <Step step="check" n={1}>
          <CodeBlock
            label="Terminal"
            labelId={`${ids}-check`}
            text={commands.check}
            what="the command"
          />
          <p className="dv3-cli-note">
            It prints the commit and helper protocol your CLI runs, without asking the board. If it
            prints a commit, use step 2.
          </p>
          <p className="dv3-cli-note" data-too-old="">
            If it answers <code>{TOO_OLD_ANSWER}</code>, your CLI is older than this board: use step
            3.
          </p>
        </Step>
        <Step step="update" n={2}>
          <CodeBlock
            label="Terminal"
            labelId={`${ids}-update`}
            text={commands.update.text}
            what="the update command"
            {...(onCopiedUpdate === undefined ? {} : { onCopied: onCopiedUpdate })}
          />
          <p className="dv3-cli-note">
            <code>--check</code> only asks. <code>laika update</code> then moves your Laika checkout
            to the commit this board was built from; nothing else on the machine changes. If{' '}
            <code>laika update</code> is an unknown command, use step 3.
          </p>
          {commands.update.allowHttp && (
            <p className="dv3-cli-note" data-allow-http="">
              <strong>Why --allow-http:</strong> {ALLOW_HTTP_WHY}
            </p>
          )}
        </Step>
        <Step step="older" n={3}>
          <p className="dv3-cli-note">See where this terminal’s laika comes from:</p>
          <CodeBlock
            label="Terminal"
            labelId={`${ids}-find`}
            text={commands.find}
            what="the command"
          />
          <p className="dv3-cli-note" data-find-note="">
            The arrow points at a file ending in <code>{LINK_TAIL}</code>: the folder that holds{' '}
            <code>cli</code> is the old checkout. If it says no such file, there is no laika on this
            terminal’s PATH — the install below is all you need.
          </p>
          {loading ? (
            <p className="dv3-cli-note">Reading where this board’s helper comes from…</p>
          ) : commands.fresh === undefined ? (
            <p className="dv3-cli-note" data-no-source="">
              This board does not say where its helper comes from, so the install cannot be filled
              in here. Ask whoever runs this board for its Laika repository and the commit it was
              built from.
            </p>
          ) : (
            <>
              <p className="dv3-cli-note" data-fresh-why="">
                <strong>Recommended:</strong> install a current checkout at <code>{CHECKOUT}</code>,
                at the commit this board was built from. It works wherever the old checkout is and
                whatever state it is in, and leaves a checkout anywhere else untouched: delete that
                folder once <code>laika version</code> answers.
              </p>
              <CodeBlock
                label={`Terminal, with no ${CHECKOUT} yet`}
                labelId={`${ids}-fresh`}
                text={commands.fresh.text}
                what="the install commands"
              />
              <p className="dv3-cli-note" data-fresh-exists="">
                If <code>{CHECKOUT}</code> already exists, this instead: it fetches rather than
                clones, and git refuses rather than overwrite a change you made there.
              </p>
              <CodeBlock
                label={`Terminal, when ${CHECKOUT} exists`}
                labelId={`${ids}-existing`}
                text={commands.fresh.existing}
                what="the install commands"
              />
              {commands.fresh.commit === null && (
                <p className="dv3-cli-note" data-fresh-default="">
                  This board does not say which commit it was built from, so this takes the newest
                  on its repository’s default branch.
                </p>
              )}
            </>
          )}
          <p className="dv3-cli-note">
            Then make this terminal look for laika again — <code>{REHASH_ZSH}</code> in zsh,{' '}
            <code>{REHASH_BASH}</code> in bash — and check:
          </p>
          <CodeBlock
            label="Terminal (zsh)"
            labelId={`${ids}-recheck`}
            text={commands.recheck}
            what="the commands"
          />
          <p className="dv3-cli-note" data-relink-note="">
            Still an unknown command? <code>install.sh</code> does not replace a laika on your PATH
            that is not a link — it says <q>{SKIP_ANSWER}</q>. And if <code>{commands.find}</code>{' '}
            still points into the old folder, that link sits in a folder earlier on your PATH. When
            that line starts with <code>l</code> (a link), point it at the new checkout, then run{' '}
            <code>{REHASH_ZSH}</code> again:
          </p>
          <CodeBlock
            label="Terminal, only for a link"
            labelId={`${ids}-relink`}
            text={commands.relink}
            what="the command"
          />
          <p className="dv3-cli-note">
            A file that is not a link is not Laika’s to replace: rename it yourself, then run the
            install again.
          </p>
        </Step>
        <Step step="after" n={4}>
          <CodeBlock
            label="Terminal"
            labelId={`${ids}-after`}
            text={commands.after}
            what="the command"
          />
          <ul className="dv3-cli-after">
            <li>
              <code>laika doctor</code> checks this machine’s setup against this board, and says
              what still needs doing.
            </li>
            <li>Restart Claude Code, so it loads the updated hooks and tools.</li>
            <li>
              Codex may ask you to trust its hooks again: open <code>/hooks</code> in Codex and
              trust them.
            </li>
          </ul>
        </Step>
      </ol>
    </div>
  );
}

export interface UpdateCliHelpProps {
  /** The one line that opens it; *How to update your Laika CLI* by default. */
  readonly summary?: string;
  readonly origin?: string;
  readonly onCopiedUpdate?: () => void;
  /** A `data-update-cli` value naming where it is placed, for tests. */
  readonly place?: string;
}

/**
 * The guide folded behind one line (a native disclosure: keyboard and screen
 * readers get it for free, and it nests inside a panel or a wizard without a
 * second modal). The guide is drawn — and the board asked — only once opened.
 */
export function UpdateCliHelp({
  summary = GUIDE_TITLE,
  origin,
  onCopiedUpdate,
  place = '',
}: UpdateCliHelpProps) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="dv3-cli-help"
      data-update-cli={place}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
      }}
    >
      <summary>{summary}</summary>
      {open && (
        <UpdateCliGuide
          {...(origin === undefined ? {} : { origin })}
          {...(onCopiedUpdate === undefined ? {} : { onCopiedUpdate })}
        />
      )}
    </details>
  );
}
