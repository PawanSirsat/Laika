import type { ReactNode, Ref } from 'react';

/*
 * Styled by `routes/screens/connect/connect.css` — see the note at the top of
 * `CodeBlock.tsx` (LAI-1044).
 */

export interface WizardCardProps {
  readonly step: number;
  readonly total: number;
  readonly title: string;
  /** One sentence under the title: what this step is for. */
  readonly line: string;
  /** The title's id; the card is labelled by it. */
  readonly titleId: string;
  /** Focus lands here on a step change, so the title takes `tabIndex={-1}`. */
  readonly titleRef?: Ref<HTMLHeadingElement> | undefined;
  /** The card's one scroller on a desktop (LAI-741). */
  readonly scrollRef?: Ref<HTMLDivElement> | undefined;
  readonly headRef?: Ref<HTMLElement> | undefined;
  /** Usually a {@link WizardFooter}; stays pinned below the scroller. */
  readonly footer: ReactNode;
  readonly children: ReactNode;
}

/**
 * One wizard step as a card: eyebrow, title and line in the head, the step's
 * body below, and the footer pinned under a scroller that holds both, so only
 * the card scrolls (LAI-741).
 */
export function WizardCard({
  step,
  total,
  title,
  line,
  titleId,
  titleRef,
  scrollRef,
  headRef,
  footer,
  children,
}: WizardCardProps) {
  return (
    <section className="conn-card conn-wizard-card" aria-labelledby={titleId} data-step={step}>
      <div className="conn-card-scroll" ref={scrollRef}>
        <header className="conn-card-head" ref={headRef}>
          <p className="conn-eyebrow">
            Step {String(step)} of {String(total)}
          </p>
          <h2 className="conn-card-title" id={titleId} tabIndex={-1} ref={titleRef}>
            {title}
          </h2>
          <p className="conn-card-line">{line}</p>
        </header>

        <div className="conn-card-body">{children}</div>
      </div>

      {footer}
    </section>
  );
}

export interface WizardFooterProps {
  readonly backDisabled: boolean;
  readonly onBack: () => void;
  /** What happens next, in words — never left for a disabled button to imply. */
  readonly hint: string;
  /** Absent on the last step, which has nothing to continue to. */
  readonly onContinue?: (() => void) | undefined;
  readonly continueDisabled?: boolean | undefined;
  readonly continueRef?: Ref<HTMLButtonElement> | undefined;
  readonly continueLabel?: string | undefined;
}

/** *Back*, a hint, and *Continue →*. */
export function WizardFooter({
  backDisabled,
  onBack,
  hint,
  onContinue,
  continueDisabled = false,
  continueRef,
  continueLabel = 'Continue',
}: WizardFooterProps) {
  return (
    <footer className="conn-card-foot">
      <button
        type="button"
        className="conn-outline conn-back"
        disabled={backDisabled}
        onClick={onBack}
      >
        Back
      </button>
      <p className="conn-foot-hint">{hint}</p>
      {onContinue !== undefined && (
        <button
          type="button"
          className="conn-continue"
          ref={continueRef}
          disabled={continueDisabled}
          onClick={onContinue}
        >
          {continueLabel} <span aria-hidden="true">→</span>
        </button>
      )}
    </footer>
  );
}
