import { BRAND_TAGLINE } from './brand-paths.ts';
import { BrandLockup } from './BrandLockup.tsx';
import './brand.css';

export interface BrandSplashProps {
  /** What is being waited for, for a screen reader. */
  readonly label?: string;
}

/**
 * The full startup loader (LAI-1126): the lockup, the tagline, and four pills
 * with a highlight stepping along them, on the brand's Ink ground.
 *
 * `index.html` carries the same picture as plain markup, so it shows before any
 * JavaScript has run; React replaces it on mount. This component is the same
 * screen for the one wait after that — a session check slow enough that
 * `SessionGate` has to show something. Same classes, so the two cannot look
 * different.
 */
export function BrandSplash({ label = 'Loading Laika' }: BrandSplashProps) {
  return (
    <div className="brand-splash" role="status" aria-label={label}>
      <div className="brand-splash-panel">
        <BrandLockup size="xl" className="brand-splash-lockup" />
        <p className="brand-splash-tagline" aria-hidden="true">
          {BRAND_TAGLINE}
        </p>
        <div className="brand-splash-steps" aria-hidden="true">
          <span className="brand-splash-step" />
          <span className="brand-splash-step" />
          <span className="brand-splash-step" />
          <span className="brand-splash-step" />
        </div>
      </div>
      <span className="visually-hidden">{label}</span>
    </div>
  );
}
