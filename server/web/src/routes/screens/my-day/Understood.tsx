export interface UnderstoodProps {
  /** `Reads as 1 h 30 min`, `Splits at 2:35 PM` — or nothing while it reads as nothing. */
  readonly text: string | undefined;
}

/**
 * What a time field understood, said back under it **before anything is
 * saved** (LAI-830): `1:30` could be a clock or a duration, and `2:35` could be
 * morning or afternoon, so the person sees the reading the page will send.
 *
 * The line is always there, empty or not, so a screen reader hears the change
 * and the form does not jump as the person types.
 */
export function Understood({ text }: UnderstoodProps) {
  return (
    <p className="myday-understood" aria-live="polite">
      {text !== undefined && <span data-understood>{text}</span>}
    </p>
  );
}
