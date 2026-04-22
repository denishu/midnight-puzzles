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

A date string (e.g. "2026-04-04") is hashed to a seed. The seed deterministically picks two countries with a shortest path of 3-11 steps. Countries with no land borders (islands) are excluded.







## 0-1 BFS — Core Algorithm (Python)

This is the algorithm that powers the cost model. It finds the cheapest path from start to end, where guessed countries cost 0 and unguessed countries cost 1.

### Why 0-1 BFS instead of regular BFS or Dijkstra?

- **Regular BFS** assumes all edges have equal weight. Here they don't — guessed countries are free (0) and unguessed cost 1.
- **Dijkstra's** handles weighted edges but uses a priority queue (O((V+E) log V)). Overkill when there are only two possible weights.
- **0-1 BFS** exploits the two-weight constraint using a deque instead of a priority queue, giving us O(V+E) — same as regular BFS.

### The trick

The deque stays sorted by cost at all times:
- **0-cost neighbor** → `appendleft` (front). Same cost as current node, process it next.
- **1-cost neighbor** → `append` (back). Higher cost, process it later.

This means `popleft()` always gives you the cheapest unprocessed node — same guarantee as Dijkstra, but without the heap overhead.

### Implementation

```python
from collections import deque

def weighted_shortest_cost(adjacency, start, end, free_set):
    """
    Find the minimum cost path from start to end on a country adjacency graph.

    Args:
        adjacency: dict mapping country -> list of neighboring countries
        start: starting country
        end: target country
        free_set: set of guessed countries (cost 0 to traverse)

    Returns:
        Minimum path cost (int), or -1 if unreachable.
        Cost of 0 means the player's guesses fully cover a path (win condition).
    """
    if start not in adjacency or end not in adjacency:
        return -1
    if start == end:
        return 0

    # dist tracks the cheapest known cost to reach each country from start
    dist = {start: 0}

    # Deque maintains nodes in roughly sorted order by cost
    # (low cost at front, high cost at back)
    dq = deque([start])

    while dq:
        # Always process the cheapest node first
        node = dq.popleft()

        # First time we pop the end node, we have the minimum cost
        # (everything still in the deque costs the same or more)
        if node == end:
            return dist[node]

        for neighbor in adjacency[node]:
            # Start, end, and guessed countries are free to traverse
            is_free = neighbor in free_set or neighbor == start or neighbor == end
            new_cost = dist[node] + (0 if is_free else 1)

            # Only update if we found a cheaper path to this neighbor
            if neighbor not in dist or new_cost < dist[neighbor]:
                dist[neighbor] = new_cost

                if is_free:
                    # Cost 0 edge: neighbor is "same distance" as current node
                    # Goes to FRONT so it's processed at the same priority level
                    dq.appendleft(neighbor)
                else:
                    # Cost 1 edge: neighbor is farther away
                    # Goes to BACK so cheaper nodes are processed first
                    dq.append(neighbor)

    return -1  # no path exists (disconnected graph, e.g. islands)
```

### How it's used per guess

Every time a player guesses a country, the algorithm runs 2-3 times:

```python
def evaluate_guess(adjacency, start, end, previous_guesses, new_guess):
    """Determine the color for a guess."""

    # 1. Cost BEFORE this guess (how expensive is the path with prior guesses?)
    cost_before = weighted_shortest_cost(adjacency, start, end, previous_guesses)

    # 2. Cost AFTER adding this guess to the free set
    free_after = previous_guesses | {new_guess}
    cost_after = weighted_shortest_cost(adjacency, start, end, free_after)

    # 3. Did this guess reduce the cost?
    if cost_after < cost_before:
        return "green"  # this guess is on a cheaper path

    # 4. Is this guess at least nearby? (cost of path forced through this guess)
    cost_through = (
        weighted_shortest_cost(adjacency, start, new_guess, free_after) +
        weighted_shortest_cost(adjacency, new_guess, end, free_after)
    )
    if cost_through <= cost_before + 1:
        return "yellow"  # slight detour, at most 1 extra

    return "red"  # far from any useful path
```

### Complexity

- **Time**: O(V + E) per call, where V = number of countries (~196), E = number of borders (~600)
- **Space**: O(V) for the dist map and deque
- **Per guess**: 2-3 calls → still O(V + E), runs in under 1ms on the country graph
