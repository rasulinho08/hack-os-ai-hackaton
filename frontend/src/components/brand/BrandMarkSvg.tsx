import type { CSSProperties } from "react";

/**
 * The flat HackOS mark, inline, so it paints with the HTML and costs no
 * request. The same drawing as public/logo.svg (see the notes there).
 */
export function BrandMarkSvg({ className, style }: { className?: string; style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 64 64" className={className} style={style} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="#E1003C" />
      <rect x="15" y="15" width="10" height="34" rx="2" fill="#FFFFFF" />
      <rect x="25" y="29" width="14" height="6" fill="#FFFFFF" />
      <rect x="39" y="15" width="10" height="20" rx="2" fill="#FFFFFF" />
      <rect x="39" y="41" width="10" height="8" rx="2" fill="#FFFFFF" />
    </svg>
  );
}
