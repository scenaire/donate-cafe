// Single source of truth for the colour palette.
//
// These values used to live in two places: the `:root` / `[data-theme="dark"]`
// blocks in globals.css, and a hand-copied duplicate inside the Stripe
// `appearance` objects in app/page.tsx (which carried a "keep in sync" comment
// — the usual sign that nothing will). The Stripe Payment Element renders in a
// cross-origin iframe and cannot read our CSS custom properties, so it genuinely
// needs the literal values; the fix is to make TypeScript the origin and have
// the CSS variables be generated from here instead of the other way round.
//
// app/layout.tsx emits `themeCss()` into <head>; globals.css consumes the
// resulting var(--x) references exactly as before.

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

export const LIGHT: Palette = {
  bg: "#fbf1ed",
  bgEdge: "#f6e1db",
  surface: "#fffcfa",
  surface2: "#fdeeea",
  sakura: "#e8a0b4",
  sakuraDeep: "#c76f89",
  matcha: "#93ac78",
  text: "#4a372f",
  muted: "#ab8d83",
  border: "rgba(199, 111, 137, 0.28)",
  danger: "#c4685f",
  accentGrad: "linear-gradient(135deg, var(--sakura), var(--sakura-deep))",
  accentSolid: "#c76f89",
  btnShadow: "0 8px 20px rgba(199, 111, 137, 0.35)",
};

// Warm plum off-black surfaces, sakura/matcha accents lifted in lightness so
// pink text and labels keep WCAG AA contrast on dark.
export const DARK: Palette = {
  bg: "#1e1518",
  bgEdge: "#2a1c22",
  surface: "#271b20",
  surface2: "#31232a",
  sakura: "#eaa7ba",
  sakuraDeep: "#e991a8",
  matcha: "#a9c48d",
  text: "#f4e7e3",
  muted: "#b89a91",
  border: "rgba(233, 145, 168, 0.26)",
  danger: "#e5867d",
  // Filled interactive surfaces use a deeper rose so they sit calmly on the
  // dark plum and keep white label text readable (the lifted accents above are
  // for text/icons — too light to fill a button with).
  accentGrad: "linear-gradient(135deg, #b8637d, #984a63)",
  accentSolid: "#a8506a",
  btnShadow: "0 8px 20px rgba(0, 0, 0, 0.4)",
};

// Literal family stacks. The Stripe Payment Element renders in a cross-origin
// iframe that can't resolve our CSS variables, so app/page.tsx feeds it
// FONT_BODY verbatim. Both also serve as the last-resort fallback inside the
// CSS-variable stacks below.
export const FONT_DISPLAY = `"Quicksand", "Noto Sans Thai", sans-serif`;
export const FONT_BODY = `"Noto Sans Thai", "Noto Sans", sans-serif`;

// What the app's own DOM actually renders in: the self-hosted next/font
// families, referenced through the CSS variables app/layout.tsx sets from
// next/font (.variable). If a variable is ever unset — e.g. a route that
// doesn't apply the font classNames — the literal stacks above take over.
const DISPLAY_VAR_STACK = `var(--font-quicksand), var(--font-noto-thai), ${FONT_DISPLAY}`;
const BODY_VAR_STACK = `var(--font-noto-thai), var(--font-noto-sans), ${FONT_BODY}`;

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

// Emitted into <head> ahead of globals.css's consumers.
export function themeCss(): string {
  return (
    `:root{${vars(LIGHT)};--font-display:${DISPLAY_VAR_STACK};--font-body:${BODY_VAR_STACK}}` +
    `[data-theme="dark"]{${vars(DARK)}}`
  );
}
