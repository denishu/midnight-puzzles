# Travle Game Logic

## Overview

The player is given two countries (start and end) and must guess intermediate countries that form a connected path between them. Each guess is colored green, yellow, or red.

## Cost Model

Every unguessed country costs **1** to traverse. Guessed countries cost **0**. The "path cost" is the sum of costs along the cheapest route from start to end (using 0-1 BFS).

At the start of the game, the cost equals the number of intermediate countries on the shortest path.

## Guess Coloring

Given:
- `S` = set of all previously guessed countries
- `g` = the country just guessed
- `cost_before` = weighted shortest path cost with free set `S`
- `cost_after` = weighted shortest path cost with free set `S ∪ {g}`
- `through_g` = cheapest path cost from start → end that **must** pass through `g` (with `g` free)

Then:

| Color | Condition |
|-------|-----------|
| **Green** | `cost_after < cost_before` — this guess reduced the remaining path cost |
| **Yellow** | `cost_after == cost_before` AND `through_g <= cost_before + 1` — a slight detour (at most 1 extra) |
| **Red** | `through_g > cost_before + 1` — this country is far from any useful path |

Colors are locked at guess time and never change retroactively.

## Example: Ghana → UAE (optimal cost = 7)

Optimal path: Ghana → Burkina Faso → Niger → Libya → Egypt → Israel → Jordan → Saudi Arabia → UAE

1. Guess **Mali**: `cost_after = 7` (same — can ignore Mali and take optimal). `through_mali = 7` (Ghana → BF → Mali → Algeria → Libya → Egypt → Israel → Jordan → Saudi → UAE, with Mali free = 7 paid). `7 <= 8` → **yellow**

2. Guess **Algeria**: `cost_after = 6` (Ghana → BF → Mali(0) → Algeria(0) → Libya → Egypt → Israel → Jordan → Saudi → UAE = 6 paid). `6 < 7` → **green**

## Win Condition

The game is won when `cost_after == 0`, meaning the player's guesses fully cover a connected path from start to end.

## Max Guesses

`max_guesses = shortest_path_length + buffer`, where buffer = `max(3, floor(path_length * 0.5))`.

## Puzzle Generation

A date string (e.g. "2026-04-04") is hashed to a seed. The seed deterministically picks two countries with a shortest path of 3-7 steps. Countries with no land borders (islands) are excluded.
