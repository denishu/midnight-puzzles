import * as fs from 'fs';
import * as path from 'path';

/**
 * Validates 5-letter word guesses against wordle word lists.
 * Answers list = valid target words; valid-guesses list = additional accepted guesses.
 */
export class WordValidator {
  private answers: Set<string> = new Set();
  private validGuesses: Set<string> = new Set();
  private answersList: string[] = [];

  /**
   * Load word lists from disk.
   * @param answersPath path to wordle-answers.txt
   * @param guessesPath path to wordle-valid-guesses.txt
   */
  loadWordLists(
    answersPath: string = path.join(__dirname, '../../data/dictionaries/wordle-answers.txt'),
    guessesPath: string = path.join(__dirname, '../../data/dictionaries/wordle-valid-guesses.txt'),
  ): void {
    const readWords = (filePath: string): string[] =>
      fs.readFileSync(filePath, 'utf-8')
        .split('\n')
        .map(w => w.trim().toLowerCase())
        .filter(w => w.length === 5);

    const answerWords = readWords(answersPath);
    this.answers = new Set(answerWords);
    this.answersList = answerWords;

    const guessWords = readWords(guessesPath);
    this.validGuesses = new Set([...answerWords, ...guessWords]);
  }

  /**
   * Load from pre-built arrays (useful for testing without file I/O).
   */
  loadFromArrays(answers: string[], additionalGuesses: string[] = []): void {
    const a = answers.map(w => w.toLowerCase());
    this.answers = new Set(a);
    this.answersList = a;
    this.validGuesses = new Set([...a, ...additionalGuesses.map(w => w.toLowerCase())]);
  }

  /** Check if a word is a valid guess (in either list). */
  isValidGuess(word: string): boolean {
    return this.validGuesses.has(word.toLowerCase());
  }

  /** Check if a word is a valid answer/target word. */
  isValidAnswer(word: string): boolean {
    return this.answers.has(word.toLowerCase());
  }

  /** Get the full list of answer words (for puzzle generation). */
  getAnswersList(): string[] {
    return [...this.answersList];
  }

  /** Get the total number of valid answers. */
  get answerCount(): number {
    return this.answers.size;
  }

  /** Get the total number of valid guesses (answers + extra guesses). */
  get guessCount(): number {
    return this.validGuesses.size;
  }
}
