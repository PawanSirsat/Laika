import { useEffect, useId, useState, type ReactNode } from 'react';
import { loadBoardBuild, type BoardBuild } from '../../../../api/developer-compat.ts';
import { CodeBlock } from '../../../../components/wizard/CodeBlock.tsx';
import {
  DEFAULT_CHECKOUT,
  GUIDE_TITLE,
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
 * Exported for Project setup's check step too — LAI-1084 owns that step's
 * hint right now, so it is not placed there by this task.
 *
 * The board's build, protocol and oldest accepted helper are read from
 * `GET /developer/compatibility` once per page and only when a guide is
 * first opened, so a screen that folds it away makes no request for it.
 */

let asked: Promise<BoardBuild | undefined> | undefined;

/** The board's build, read once for the page's life; `undefined` when it could not say. */
function boardBuild(): Promise<BoardBuild | undefined> {
  asked ??= loadBoardBuild();
  return asked;
}

/** `'loading'` until the answer is in. */
function useBoardBuild(): BoardBuild | undefined | 'loading' {
  const [build, setBuild] = useState<BoardBuild | undefined | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    void boardBuild().then((answer) => {
      if (live) setBuild(answer);
    });
    return () => {
      live = false;
    };
  }, []);
  return build;
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
 * The four steps, in order: check, update with `laika update`, update an
 * older CLI's checkout, and what to do after. `--allow-http` appears only
 * when this board is plain http off loopback, exactly as Tool details' own
 * update command does (`updateCommand`).
 */
export function UpdateCliGuide({ origin, onCopiedUpdate }: UpdateCliGuideProps) {
  const ids = useId();
  const build = useBoardBuild();
  const commands = guideCommands(origin ?? currentOrigin());
  return (
    <div className="dv3-cli-guide" data-update-cli-guide="">
      <p className="dv3-cli-board" data-board-build={build === 'loading' ? 'loading' : ''}>
        {build === 'loading' ? 'Reading which build this board runs…' : boardLine(build)}
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
            It prints the commit and helper protocol your CLI runs, without asking the board.
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
            to the commit this board was built from; nothing else on the machine changes.
          </p>
          {commands.update.allowHttp && (
            <p className="dv3-cli-note" data-allow-http="">
              <strong>Why --allow-http:</strong> {ALLOW_HTTP_WHY}
            </p>
          )}
        </Step>
        <Step step="older" n={3}>
          <p className="dv3-cli-note">
            If <code>laika update</code> is an unknown command too, update the Laika checkout your
            CLI runs from. It only moves forward: if git refuses, nothing has changed, and it says
            why.
          </p>
          <CodeBlock
            label="Terminal"
            labelId={`${ids}-older`}
            text={commands.older}
            what="the command"
          />
          <p className="dv3-cli-note" data-replace-path="">
            Replace <code>{DEFAULT_CHECKOUT}</code> with where you cloned Laika. Not sure where?{' '}
            <code>{commands.find}</code> prints the file your terminal runs; the folder before{' '}
            <code>/cli/bin/laika</code> is your checkout.
          </p>
          <p className="dv3-cli-note">
            Then <code>laika version</code> answers, and <code>laika update --check</code> says
            whether it matches this board.
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
