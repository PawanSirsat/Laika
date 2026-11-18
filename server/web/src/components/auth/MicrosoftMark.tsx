/**
 * The four squares beside *Sign in with Microsoft* (LAI-1238).
 *
 * Drawn in `currentColor`, not Microsoft's four colours: the theme owns every
 * colour on the page, and the words on the button already say whose sign-in
 * it is. Not in the icon registry, which keeps vendors' marks out on purpose
 * (`icon-paths.ts`) — this is a provider's mark, used only on its own button.
 */
export function MicrosoftMark({ size = 16 }: { readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1" y="1" width="8.5" height="8.5" />
      <rect x="10.5" y="1" width="8.5" height="8.5" />
      <rect x="1" y="10.5" width="8.5" height="8.5" />
      <rect x="10.5" y="10.5" width="8.5" height="8.5" />
    </svg>
  );
}
