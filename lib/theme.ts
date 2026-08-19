// Single source of truth for the colour palette + design tokens.
//
// The pixel/retro-cozy "Whispering Rain Café" system. There is ONE fixed look
// (no dark mode): the design commits to a single palette. Values live here in
// TypeScript because the Stripe Payment Element renders in a cross-origin iframe
// that cannot read our CSS custom properties, so it needs the literal values;
// making TypeScript the origin keeps the CSS variables and the Stripe
// `appearance` object from drifting apart.
//
// app/layout.tsx emits themeCss() into <head>; app/globals.css and every
// component consume the resulting var(--x) references.
//
// The `Palette` shape below is retained (same field names) so existing
// consumers — stripeAppearance() in app/page.tsx and the legacy var(--sakura*)
// references in globals.css — keep compiling while the UI is rebuilt on top of
// the richer pixel token set added in themeCss(). Prefer the pixel tokens
// (--ink, --pink, --card, …) in new code.

export type Palette = {
  bg: string;
  bgEdge: string;
  surface: string;
  surface2: string;
  sakura: string;
  sakuraDeep: string;
  matcha: string;
  text: string;
  muted: string;
  border: string;
  danger: string;
  accentGrad: string;
  accentSolid: string;
  btnShadow: string;
};

// The one café palette, mapped onto the legacy Palette field names.
//  sakura      → pink primary (#F4A9BD)
//  sakuraDeep  → primary border / ink (#9E4B54)
//  surface     → card cream (#FDF5E4)   surface2 → well (#EEDCBE)
export const LIGHT: Palette = {
  bg: "#5F3A40",
  bgEdge: "#5F3A40",
  surface: "#FDF5E4",
  surface2: "#EEDCBE",
  sakura: "#F4A9BD",
  sakuraDeep: "#9E4B54",
  matcha: "#C9A24B",
  text: "#6B4535",
  muted: "#8E6B5B",
  border: "#DBB79A",
  danger: "#C4646F",
  accentGrad: "repeating-linear-gradient(90deg,#F4A9BD 0 10px,#F0A0B5 10px 20px)",
  accentSolid: "#9E4B54",
  btnShadow: "0 6px 0 #9E4B54",
};

// No dark mode in this design. DARK is kept identical to LIGHT so any lingering
// consumer of the dark path (or a stale data-theme="dark" attribute) renders the
// one intended look instead of a broken half-palette. Removed entirely once the
// last dark-mode reference (ThemeToggle / providers) is deleted in the page rewrite.
export const DARK: Palette = LIGHT;

// Literal family stacks fed to the cross-origin Stripe iframe (which can't
// resolve our CSS variables) and used as the last-resort fallback in the
// variable stacks below.
export const FONT_DISPLAY = `"DotGothic16", "IBM Plex Sans Thai Looped", sans-serif`;
export const FONT_LABEL = `"Silkscreen", "DotGothic16", monospace`;
export const FONT_BODY = `"IBM Plex Sans Thai Looped", "Noto Sans Thai", sans-serif`;

// The next/font variables set on <html> in app/layout.tsx. The variable names
// here MUST match the ones declared there.
const DISPLAY_VAR_STACK = `var(--font-dotgothic), ${FONT_DISPLAY}`;
const LABEL_VAR_STACK = `var(--font-silkscreen), ${FONT_LABEL}`;
const BODY_VAR_STACK = `var(--font-plex-thai), ${FONT_BODY}`;

// ── Pixel design tokens ─────────────────────────────────────────────────────
// The full handoff palette, exposed as CSS custom properties for new components.
// Grouped by role; hard offset shadows only (no blurred elevation).
const PIXEL_TOKENS: Record<string, string> = {
  // surfaces
  "--page": "#5F3A40",
  "--card": "#FDF5E4",
  "--paper": "#FFFBF2",
  // ink
  "--ink": "#9E4B54",
  "--deep-ink": "#7A3F49",
  "--body-text": "#6B4535",
  "--muted-text": "#8E6B5B",
  "--label-text": "#9A6656",
  "--faint-label": "#B07B6A",
  "--faint-label-2": "#C0A08F",
  "--disabled-fg": "#A98876",
  "--button-ink": "#6B2F3A",
  // pinks
  "--pink": "#FDD3E0",
  "--pink-a": "#F4A9BD",
  "--pink-b": "#F0A0B5",
  "--pink-deep": "#EE93AB",
  // borders / wells
  "--soft-border": "#DBB79A",
  "--secondary-border": "#C4818F",
  "--well": "#EEDCBE",
  "--well-2": "#E7D2B0",
  "--well-3": "#F7E7CB",
  "--well-4": "#F1E2C8",
  "--dashed-rule": "#D8C3AC",
  // error
  "--error-border": "#C4646F",
  "--error-bg": "#FBDCDF",
  "--error-text": "#8C3742",
  // accents
  "--accent-purple": "#C9A2D6",
  "--accent-purple-2": "#B98FC8",
  "--gold": "#C9A24B",
  // light-on-dark
  "--on-dark": "#F2D9C6",
  "--on-dark-2": "#FDF5E4",
  // striped CTA fill + hard button shadow
  "--cta-fill": "repeating-linear-gradient(90deg,#F4A9BD 0 10px,#F0A0B5 10px 20px)",
  "--btn-shadow-1": "0 3px 0 #9E4B54",
  "--btn-shadow-2": "0 4px 0 #9E4B54",
  "--btn-shadow-3": "0 6px 0 #9E4B54",
};

function vars(p: Palette): string {
  return [
    `--bg:${p.bg}`,
    `--bg-edge:${p.bgEdge}`,
    `--surface:${p.surface}`,
    `--surface-2:${p.surface2}`,
    `--sakura:${p.sakura}`,
    `--sakura-deep:${p.sakuraDeep}`,
    `--matcha:${p.matcha}`,
    `--text:${p.text}`,
    `--muted:${p.muted}`,
    `--border:${p.border}`,
    `--danger:${p.danger}`,
    `--accent-grad:${p.accentGrad}`,
    `--accent-solid:${p.accentSolid}`,
    `--btn-shadow:${p.btnShadow}`,
  ].join(";");
}

function pixelVars(): string {
  return Object.entries(PIXEL_TOKENS)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

// Emitted into <head> ahead of globals.css's consumers. One palette, no dark
// block — the design is a single fixed look.
export function themeCss(): string {
  return (
    `:root{${vars(LIGHT)};${pixelVars()};` +
    `--font-display:${DISPLAY_VAR_STACK};--font-label:${LABEL_VAR_STACK};--font-body:${BODY_VAR_STACK}}`
  );
}
