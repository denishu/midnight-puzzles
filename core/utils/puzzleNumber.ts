/**
 * Deterministic daily puzzle number, à la Wordle.
 *
 * The puzzle "day" is UTC (all games are seeded by the UTC date), so the number
 * is simply the count of whole UTC days since a fixed epoch, +1. It is stateless
 * — every part of the system derives the same number from a date, so the bot,
 * the Activity, and the recap can never disagree, and it survives restarts.
 *
 * Epoch: 2026-10-01 (UTC) = puzzle #1.
 *
 * Examples:
 *   2026-10-01 -> #1
 *   2026-10-02 -> #2
 *   2027-10-01 -> #366
 *
 * Dates before the epoch clamp to #1 (the number is only meaningful going
 * forward; a recap should never show #0 or a negative).
 */

/** UTC-midnight epoch: 2026-10-01 = puzzle #1. */
export const PUZZLE_EPOCH_UTC = Date.UTC(2026, 9, 1); // month is 0-based: 9 = October

const MS_PER_DAY = 86_400_000;

/** Midnight-UTC timestamp for the calendar date of `d`. */
function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * The puzzle number for the UTC date of `date`. Clamped to a minimum of 1.
 */
export function puzzleNumber(date: Date, epochUtcMs: number = PUZZLE_EPOCH_UTC): number {
  const days = Math.floor((utcMidnight(date) - epochUtcMs) / MS_PER_DAY);
  return Math.max(1, days + 1);
}
