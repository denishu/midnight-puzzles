/**
 * Lightweight input validation for user-supplied guess payloads.
 *
 * These run at the HTTP boundary, before a guess reaches the game engine or DB.
 * They are deliberately permissive about *content* (the game engines already
 * decide whether a word/country is valid) but strict about *shape*: reject
 * non-strings, empty input, absurd lengths, and unexpected characters so
 * malformed or abusive payloads never reach the expensive path.
 */

export interface ValidationResult {
  ok: boolean;
  /** Normalized value (trimmed) when ok. */
  value?: string;
  /** Human-readable reason when not ok. */
  error?: string;
}

/** Max length for a free-text guess (word/country name). Generous but bounded. */
const MAX_GUESS_LENGTH = 60;

/**
 * Validate a free-text guess (Semantle words, Travle country names).
 * Allows letters, spaces, hyphens, apostrophes, periods (e.g. "St. Lucia",
 * "Côte d'Ivoire"). Rejects control chars, digits-only, and over-long input.
 */
export function validateGuessText(input: unknown): ValidationResult {
  if (typeof input !== 'string') {
    return { ok: false, error: 'guess must be a string' };
  }
  const value = input.trim();
  if (value.length === 0) {
    return { ok: false, error: 'guess is empty' };
  }
  if (value.length > MAX_GUESS_LENGTH) {
    return { ok: false, error: `guess too long (max ${MAX_GUESS_LENGTH})` };
  }
  // Unicode letters (accented names), plus spaces and common name punctuation.
  if (!/^[\p{L}][\p{L} .'-]*$/u.test(value)) {
    return { ok: false, error: 'guess contains invalid characters' };
  }
  return { ok: true, value };
}

/**
 * Validate a Wordle-style 5-letter guess (Duotrigordle). Exactly 5 ASCII
 * letters. Returns the uppercased value on success.
 */
export function validateWordleGuess(input: unknown): ValidationResult {
  if (typeof input !== 'string') {
    return { ok: false, error: 'guess must be a string' };
  }
  const value = input.trim();
  if (!/^[A-Za-z]{5}$/.test(value)) {
    return { ok: false, error: 'guess must be exactly 5 letters' };
  }
  return { ok: true, value: value.toUpperCase() };
}
