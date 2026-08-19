# Product

## Register

product

## Users

Viewers and fans of streamer Naire, arriving from a Twitch/YouTube stream or its chat to send a tip. Mostly on mobile, often mid-stream — they want to pick an amount, pay fast (PromptPay QR or card), and get back to watching. Secondary audience: Naire herself, via the `/dashboard` admin view, reconciling and overriding orders.

## Product Purpose

A tip jar shaped like a small café: viewers "order a treat" (a named price tier or custom amount), optionally leave a message, and pay via Stripe (PromptPay QR for THB, card for everything else). Payment triggers an on-screen alert and optional text-to-speech during the stream. Success looks like: the payer completes checkout in under a minute without confusion about amount, currency, or payment status, and the alert fires reliably exactly once.

## Brand Personality

Cozy, playful, sincere. A handmade pixel-art café — warm plum/pink palette, dot-matrix display type, hard offset shadows (no blurred elevation), gentle Thai/English copy with a light kawaii touch (♡, soft phrasing) that never tips into childish. The café framing is a skin over a transactional flow: charm should lower the guard of a payment screen, not obscure what's happening with the money.

## Anti-references

- Generic SaaS/fintech checkout — cold, corporate, gradient-card payment UI. The opposite of the handmade café feel.
- Trendy Web3/crypto neon — glowing neon, glassmorphism, dark futuristic finance aesthetics.
- Overly childish/cartoonish — stay cute, not juvenile; this is still real money changing hands.

## Design Principles

- **The transaction stays legible.** No matter how illustrated the surface gets, amount, currency, payment status, and QR expiry must read instantly and unambiguously — this is a payment screen wearing a costume, not a game.
- **One fixed look, committed.** No dark mode, no per-user theming — the single café palette (lib/theme.ts) is the brand; extend it rather than introducing new colors ad hoc.
- **Charm earns its place via specificity, not decoration.** The kawaii voice, pixel fonts, and hard shadows are a deliberate, consistent system (see CLAUDE.md / lib/cafe.ts) — new UI should extend that system's actual tokens, not add generic "cute" flourishes on top of it.
- **Mobile-first, stream-adjacent.** Most payers are on a phone, possibly one-handed, mid-stream. Priority visual weight goes to the thing they need next (amount, QR, pay button), not to embellishment.
- **Money needs micro-precision.** Currency formatting, expiry countdowns, and status states must be exactly correct (see lib/money.ts) — this is the one area where "good enough" is not good enough.

## Accessibility & Inclusion

Standard WCAG AA: body text ≥4.5:1 contrast, large/bold text ≥3:1, tap targets ≥44px, focus states preserved on all interactive elements. No specific additional population to design for beyond that baseline.
