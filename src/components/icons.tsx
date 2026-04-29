/**
 * Custom SVG icons. Drawn 16x16, 1.4 stroke, current-color.
 *
 * Slightly off-grid points and non-uniform corners give a quiet hand-drawn feel
 * that pairs with the warm cream palette without leaning on overt drafting
 * decor (the T-square / set-square / compass illustrations were retired during
 * the minimal pass — the chrome is now icon + label only).
 */
import type { FC, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (props: IconProps) => ({
  width: props.size ?? 16,
  height: props.size ?? 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.4,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  ...props,
});

export const FolderIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M2 4.6c0-.7.6-1.2 1.3-1.2H6l1.6 1.6h5.1c.7 0 1.3.6 1.3 1.3v5.1c0 .7-.6 1.3-1.3 1.3H3.3c-.7 0-1.3-.6-1.3-1.3V4.6Z" />
  </svg>
);

export const FolderOpenIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M2 4.6c0-.7.6-1.2 1.3-1.2H6l1.6 1.6h5.1c.7 0 1.3.6 1.3 1.3V7" />
    <path d="M2.3 7.5h11.4l-1.4 4.4c-.2.5-.6.8-1.1.8H3.4c-.7 0-1.3-.6-1.3-1.3l.2-3.9Z" />
  </svg>
);

/** Folder with a + inside — used for the "new folder" topbar button. */
export const FolderPlusIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M2 4.6c0-.7.6-1.2 1.3-1.2H6l1.6 1.6h5.1c.7 0 1.3.6 1.3 1.3v5.1c0 .7-.6 1.3-1.3 1.3H3.3c-.7 0-1.3-.6-1.3-1.3V4.6Z" />
    <path d="M8 7v3.4" />
    <path d="M6.3 8.7h3.4" />
  </svg>
);

/** A nib/pen tip — used for drawing files. Custom; not a generic doc icon. */
export const NibIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M11.4 2.4 13.6 4.6l-7 7-3 1 1-3 7-7Z" />
    <path d="M10.2 3.6l2.2 2.2" />
    <path d="M4 12l1 1" />
  </svg>
);

export const ChevronRight: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
);

export const ChevronDown: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M3.5 6 8 10.5 12.5 6" />
  </svg>
);

export const PlusIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M8 3.2v9.6" />
    <path d="M3.2 8h9.6" />
  </svg>
);

export const MoonIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M13.4 9.6A5.6 5.6 0 0 1 6.4 2.6a5.7 5.7 0 1 0 7 7Z" />
  </svg>
);

export const SunIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.8" />
    <path d="M8 1.6V3M8 13v1.4M1.6 8H3M13 8h1.4M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </svg>
);

/** Three short rule lines, drafting-style — used for "show sidebar". */
export const SidebarShowIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M2.5 4h6" />
    <path d="M2.5 8h11" />
    <path d="M2.5 12h8" />
  </svg>
);

/** Used in dialog context line and footer. */
export const CornerArrowIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M4 4h6.5a1.5 1.5 0 0 1 1.5 1.5V12" />
    <path d="M9 9l3 3 3-3" />
  </svg>
);

export const ReturnKeyIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M14 4v3.5a1.5 1.5 0 0 1-1.5 1.5H3" />
    <path d="M5.5 6.5 3 9l2.5 2.5" />
  </svg>
);

/**
 * Import: tray with downward arrow dropping into it. Used in the topbar
 * Import button. Reads as "bring something into the inbox".
 */
export const ImportIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M8 2.4v6.5" />
    <path d="M5.2 6.4 8 9.2l2.8-2.8" />
    <path d="M2.5 10.5v1.6c0 .8.6 1.4 1.4 1.4h8.2c.8 0 1.4-.6 1.4-1.4v-1.6" />
  </svg>
);

/**
 * Update-available glyph: an upward arrow rising to a horizontal rail.
 * Reads as "elevate to the new version above current". Sits beside a
 * small accent dot in the topbar when an update is ready to install.
 */
export const UpdateIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M3 3h10" />
    <path d="M8 13.2V6.6" />
    <path d="M5 9.4 8 6.4l3 3" />
  </svg>
);

/**
 * Restart glyph: a squared loop arrow. Used after install completes to
 * indicate clicking will relaunch the app on the new version.
 */
export const RestartIcon: FC<IconProps> = (p) => (
  <svg {...base(p)}>
    <path d="M3.2 8a4.8 4.8 0 0 1 8.6-2.9" />
    <path d="M11.8 2.6v2.6H9.2" />
    <path d="M12.8 8a4.8 4.8 0 0 1-8.6 2.9" />
    <path d="M4.2 13.4v-2.6h2.6" />
  </svg>
);
