/**
 * Pin or unpin a space (LAI-989), in the sidebar's rows and the More-spaces
 * popover. A control of its own beside a row's link or button, never inside
 * it: a button inside a link is two controls in one, and the row's text would
 * then carry the pin's name.
 */
export function PinButton({
  name,
  pinned,
  onToggle,
}: {
  readonly name: string;
  readonly pinned: boolean;
  readonly onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className="space-pin"
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
      title={pinned ? 'Unpin' : 'Pin to the top'}
      onClick={onToggle}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill={pinned ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M9 3h6l-1 6 4 4H6l4-4-1-6ZM12 13v8" />
      </svg>
    </button>
  );
}
