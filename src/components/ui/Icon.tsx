import type { SVGProps } from "react";

/**
 * The Stitch export pulled in the whole Material Symbols webfont from Google
 * just to draw fifteen glyphs. These are the same fifteen as inline 24x24
 * paths, so the page ships no third-party font request.
 */
const ICON_PATHS = {
  person:
    "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  arrow_forward: "M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z",
  verified_user:
    "M12 1 3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1.6 15.4L6.2 12.2l1.4-1.4 2.8 2.8 6.2-6.2 1.4 1.4-7.6 7.6z",
  check_circle:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z",
  key: "M21 10h-8.35A6 6 0 1 0 7 18a6 6 0 0 0 5.65-4H13l2 2 2-2 2 2 3-3.06L21 10zM7 15a3 3 0 1 1 0-6 3 3 0 0 1 0 6z",
  account_tree: "M22 11V3h-7v3H9V3H2v8h7V8h2v10h4v3h7v-8h-7v3h-2V8h2v3z",
  token: "M12 2 3.5 7v10L12 22l8.5-5V7L12 2zm0 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
  smart_toy:
    "M20 9V7a2 2 0 0 0-2-2h-3a3 3 0 0 0-6 0H6a2 2 0 0 0-2 2v2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2zM9 15a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm6 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z",
  policy:
    "M12 1 3 5v6c0 5.55 3.84 10.74 9 12a11.4 11.4 0 0 0 4.4-2.34l3.19 3.19 1.41-1.41-3.19-3.19A11.9 11.9 0 0 0 21 11V5l-9-4zm0 6a4 4 0 1 1 0 8 4 4 0 0 1 0-8z",
  lock: "M18 8h-1V6A5 5 0 0 0 7 6v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 1 1 6 0v2H9V6zm3 13a2 2 0 1 1 0-4 2 2 0 0 1 0 4z",
  lock_reset:
    "M12 2a7 7 0 0 0-7 7H2.5l3.25 3.25L9 9H7a5 5 0 1 1 1.47 3.53l-1.42 1.42A7 7 0 1 0 12 2zm5 9h-1v-1a4 4 0 0 0-8 0v1H7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7a1 1 0 0 0-1-1zm-6.5-1a1.5 1.5 0 0 1 3 0v1h-3v-1z",
  block:
    "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM4 12a8 8 0 0 1 12.9-6.31L5.69 16.9A7.9 7.9 0 0 1 4 12zm8 8a7.9 7.9 0 0 1-4.9-1.69L18.31 7.1A8 8 0 0 1 12 20z",
  cancel:
    "M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z",
  data_object:
    "M4 7v2c0 .55-.45 1-1 1H2v4h1c.55 0 1 .45 1 1v2a3 3 0 0 0 3 3h2v-2H7c-.55 0-1-.45-1-1v-2c0-1.31-.84-2.42-2-2.83v-.34C5.16 11.42 6 10.31 6 9V7c0-.55.45-1 1-1h2V4H7a3 3 0 0 0-3 3zm17 3c-.55 0-1-.45-1-1V7a3 3 0 0 0-3-3h-2v2h2c.55 0 1 .45 1 1v2c0 1.31.84 2.42 2 2.83v.34c-1.16.41-2 1.52-2 2.83v2c0 .55-.45 1-1 1h-2v2h2a3 3 0 0 0 3-3v-2c0-.55.45-1 1-1h1v-4h-1z",
  mark_chat_read:
    "M12 2C6.48 2 2 6.02 2 11c0 2.4 1.05 4.58 2.75 6.19L4 22l5.13-2.03c.92.24 1.88.36 2.87.36 5.52 0 10-4.02 10-9s-4.48-9-10-9zm-1 12-3-3 1.41-1.41L11 11.17l4.59-4.58L17 8l-6 6z",
  expand_more: "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z",
  chevron_left: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  chevron_right: "M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z",
  logout:
    "M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.59L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z",
  warning: "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z",
  menu: "M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z",
} as const;

export type IconName = keyof typeof ICON_PATHS;

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  /** Rendered pixel size; matches the text-[Npx] sizing used by the export. */
  size?: number;
}

export function Icon({ name, size = 20, className, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className ?? ""}`}
      {...props}
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
