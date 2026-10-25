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
}
