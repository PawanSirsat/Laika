import { FILE_GLYPHS, type FileKind } from './editor/attach.ts';

/**
 * A file's glyph (D-150, LAI-1301): the paperclip, or a page drawn for its
 * kind — the 24-grid line paths in `attach.ts`, in `currentColor`, so the
 * colour is the surrounding chip's and both themes follow. Decoration beside
 * a name that is always there for assistive tech, so `aria-hidden`.
 */
export function FileGlyph({
  kind,
  size = 16,
}: {
  readonly kind: FileKind | 'paperclip';
  readonly size?: number;
}) {
  return (
    <svg
      className="file-glyph"
      data-kind={kind}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      {FILE_GLYPHS[kind].map((d) => (
        <path
          key={d}
          d={d}
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
