# Shared UI Design Tokens

> **Source of truth: [`tokens.css`](./tokens.css).** Each game `<link>`s that file
> and overrides only its per-game accent via `--game-accent`. Do not re-copy
> values into game files — reference the CSS variables so the suite stays
> consistent. (This doc previously held a parallel set of tokens that drifted
> from the games; it's now just a guide to the real file.)

The visual identity is derived from the landing page (`web/landing/styles.css`)
so clicking from the site into a game feels like one product: a **midnight-purple**
dark theme with per-game accents.

## Fonts (two roles)

Set in `tokens.css` as CSS variables so they can be changed in one place:

- `--font-display` → **Quicksand** — titles / headers (brand).
- `--font-body` → **Nunito** — everything else (buttons, inputs, lists, chips,
  and the Duotrigordle letter grid — Nunito proved legible even there, so no
  separate grid font is used).

To revert the games to a single neutral font (e.g. Inter), change the two
`--font-*` values in `tokens.css`.

## Per-game accent

| Game         | `--game-accent`              |
|--------------|------------------------------|
| Semantle     | `--primary` (purple)         |
| Travle       | `--secondary` (gold)         |
| Duotrigordle | `--accent` (green)           |

## Usage

```html
<link rel="stylesheet" href="/shared/tokens.css">
<!-- then, on the game's own stylesheet or inline: -->
<style>:root { --game-accent: var(--secondary); } /* Travle */</style>
```

Shared opt-in classes: `.mp-base`, `.mp-display`, `.mp-input`, `.mp-btn`,
`.mp-card`, `.mp-overlay`. See `tokens.css` for the full token list (palette,
spacing scale, radii, shadows, transitions).
