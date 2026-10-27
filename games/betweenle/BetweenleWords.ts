import * as fs from 'fs';
import * as path from 'path';

/**
 * Word data for Betweenle.
 *
 * Two lists, mirroring the real game:
 *  - answers: the daily SECRET is drawn only from these (curated common words,
 *    `betweenle-answers.txt` = the canonical Wordle answer list). The player
 *    must actually KNOW the word, since the only signal is alphabetical.
 *  - dictionary (rank space): the permissive set of VALID GUESSES
 *    (`wordle-valid-guesses.txt`, which also contains every answer). This
 *    sorted list defines each word's RANK, and the distance a guess reports is
 *    the fraction of the dictionary lying between the guess and the secret.
 *
 * Invariant (verified at load): every answer is in the dictionary, so every
 * secret has a defined rank.
 */
export class BetweenleWords {
  /** Secret candidates (lowercase). */
  private answers: string[] = [];
  /** Sorted unique dictionary (lowercase) — the rank space. */
  private dictionary: string[] = [];
  /** word -> rank (index in the sorted dictionary). */
  private rank: Map<string, number> = new Map();

  loadFromDisk(
    answersPath = path.join(process.cwd(), 'data/dictionaries/betweenle-answers.txt'),
    dictionaryPath = path.join(process.cwd(), 'data/dictionaries/wordle-valid-guesses.txt'),
  ): void {
    const read = (p: string): string[] =>
      fs.readFileSync(p, 'utf-8')
        .split(/\s+/)                       // tolerate newline- OR space-delimited
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length === 5);
    this.loadFromArrays(read(answersPath), read(dictionaryPath));
  }

  /** Load from arrays (tests / custom data). */
  loadFromArrays(answers: string[], dictionary: string[]): void {
    const ans = answers.map(w => w.toLowerCase()).filter(w => w.length === 5);
    // The rank space is the UNION of dictionary + answers, sorted & deduped, so
    // the invariant (every answer has a rank) always holds even if a caller
    // passes a dictionary that omits an answer.
    const dictSet = new Set<string>([...dictionary, ...ans].map(w => w.toLowerCase()).filter(w => w.length === 5));
    this.dictionary = [...dictSet].sort();
    this.rank = new Map(this.dictionary.map((w, i) => [w, i]));
    this.answers = ans;

    if (this.answers.length === 0) throw new Error('Betweenle: empty answers list');
    if (this.dictionary.length === 0) throw new Error('Betweenle: empty dictionary');
  }

  /** Number of words in the rank space. */
  get size(): number {
    return this.dictionary.length;
  }

  get answersList(): string[] {
    return [...this.answers];
  }

  /** Is `word` an accepted guess (present in the dictionary)? */
  isValidGuess(word: string): boolean {
    return this.rank.has(word.toLowerCase());
  }

  /** Rank (0-based index) of a word in the sorted dictionary, or -1 if absent. */
  rankOf(word: string): number {
    return this.rank.get(word.toLowerCase()) ?? -1;
  }

  /**
   * Distance between a guess and the secret, as a PERCENT of the dictionary
   * lying between them: |rank(guess) - rank(secret)| / size * 100. Both words
   * must be in the dictionary. Rounded to 2 decimals (matches the game's
   * display, e.g. 40, 58, 12, 4.1).
   */
  distancePercent(guess: string, secret: string): number {
    const a = this.rankOf(guess);
    const b = this.rankOf(secret);
    if (a < 0 || b < 0) throw new Error(`Betweenle: word not in dictionary (${guess} / ${secret})`);
    const pct = (Math.abs(a - b) / this.dictionary.length) * 100;
    return Math.round(pct * 100) / 100;
  }

  /**
   * Can the typed `prefix` still become a real guess that is strictly between
   * the current bounds? Powers the live keyboard + out-of-range rejection.
   *
   * Two stages, cheap-first:
   *   1. RANGE (O(1)): compare `prefix` against the equal-length prefix of each
   *      bound. If `prefix < lower[:n]` or `prefix > upper[:n]`, it can never be
   *      in range -> reject immediately (e.g. "ta" with bounds tight..tuber).
   *   2. EXISTENCE (O(log N)): binary-search the sorted dictionary for the first
   *      word >= prefix; feasible iff that word startsWith(prefix) AND lies
   *      STRICTLY between the bounds (bounds are already-guessed words, so the
   *      open interval excludes them). This rejects in-band-but-nonexistent
   *      prefixes like "slq".
   *
   * `lower`/`upper` are the current bound words (use the sentinels 'aaaaa' /
   * 'zzzzz' when a side hasn't been pinned by a real guess yet). `prefix` may be
   * 1-5 chars; an empty prefix is always feasible.
   */
  prefixIsFeasible(prefix: string, lower: string, upper: string): boolean {
    const p = prefix.toLowerCase();
    if (p.length === 0) return true;
    const n = p.length;

    // Stage 1: range on the equal-length prefix slices.
    if (p < lower.slice(0, n)) return false;
    if (p > upper.slice(0, n)) return false;

    // Stage 2: a real dictionary word with this prefix, strictly in (lower, upper).
    // The first word >= prefix may itself be <= lower (below the bound) while a
    // LATER word sharing the prefix is in range, so advance past any words that
    // are <= lower before checking prefix-membership and the upper bound.
    let i = this.lowerBoundIndex(p);
    while (i < this.dictionary.length && this.dictionary[i]! <= lower) i++;
    const w = this.dictionary[i];
    if (!w || !w.startsWith(p)) return false;
    return w < upper;
  }

  /** Index of the first dictionary word >= `target` (binary search). */
  private lowerBoundIndex(target: string): number {
    let lo = 0, hi = this.dictionary.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.dictionary[mid]! < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Is `word` a valid, in-range guess strictly between the given bounds? */
  isInRange(word: string, lower: string, upper: string): boolean {
    const w = word.toLowerCase();
    return this.isValidGuess(w) && w > lower && w < upper;
  }
}
