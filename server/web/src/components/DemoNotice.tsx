import './demo-notice.css';

export interface DemoNoticeProps {
  /** What on this screen is not real, in the reader's terms. */
  readonly what: string;
}

/**
 * Says plainly that part of a screen is sample data.
 *
 * The owner asked to see the design realised on screens whose endpoints do not
 * exist yet, which means putting numbers on screen that nobody can act on. That
 * is only safe if it is **labelled** — an unmarked placeholder is indomitable
 * once someone screenshots it into a status update.
 *
 * Every screen leaning on `src/demo/` renders one of these.
 */
export function DemoNotice({ what }: DemoNoticeProps) {
  return (
    <p className="demo-notice" role="note">
      <span className="demo-notice-tag">SAMPLE</span>
      {what}
    </p>
  );
}
