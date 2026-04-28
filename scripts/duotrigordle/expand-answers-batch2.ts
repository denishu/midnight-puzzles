/**
 * Batch 2: Add 600 more words to wordle-answers.txt from wordle-valid-guesses.txt.
 *
 * Takes 300 words starting from line 3000 and 300 starting from line 7500
 * of the candidates list (valid-guesses minus current answers minus profanity).
 *
 * Usage: npx ts-node scripts/duotrigordle/expand-answers-batch2.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const PROFANITY: Set<string> = new Set([
  'asses', 'bitch', 'bitty', 'blows', 'boobs', 'booty',
  'cocks', 'cooch', 'craps', 'cunts', 'dicks', 'dildo',
  'dykes', 'fanny', 'farts', 'fucks', 'grope', 'horny',
  'humps', 'juggs', 'kinky', 'knobs', 'milfs', 'moron',
  'negro', 'nippy', 'orgys', 'pansy', 'penis', 'pimps',
  'porno', 'porny', 'pussy', 'queef', 'rapey', 'recta',
  'retch', 'schmo', 'semen', 'sexed', 'sexes', 'shags',
  'shits', 'skank', 'slags', 'slits', 'sluts', 'smuts',
  'snogs', 'spank', 'sperm', 'spunk', 'sucks', 'tarts',
  'titty', 'tramp', 'twerk', 'twits', 'vagal', 'vixen',
  'vulva', 'wanks', 'whore', 'wussy',
]);

const DICT_DIR = path.join(__dirname, '../../data/dictionaries');
const ANSWERS_PATH = path.join(DICT_DIR, 'wordle-answers.txt');
const GUESSES_PATH = path.join(DICT_DIR, 'wordle-valid-guesses.txt');

function readWords(filePath: string): string[] {
  return fs.readFileSync(filePath, 'utf-8')
    .split('\n')
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length === 5 && /^[a-z]{5}$/.test(w));
}

function main() {
  const answers = readWords(ANSWERS_PATH);
  const guesses = readWords(GUESSES_PATH);
  const answersSet = new Set(answers);

  console.log(`Current answers: ${answers.length}`);
  console.log(`Valid guesses:   ${guesses.length}`);

  // Candidates = in guesses, not in answers, not profanity
  const candidates = guesses.filter(w => !answersSet.has(w) && !PROFANITY.has(w));
  console.log(`Candidates: ${candidates.length}`);

  // 300 starting from index 3000
  const from3000 = candidates.slice(3000, 3300);
  // 300 starting from index 7500
  const from7500 = candidates.slice(7500, 7800);

  console.log(`\nFrom index 3000: ${from3000.length} (${from3000[0]} .. ${from3000[from3000.length - 1]})`);
  console.log(`From index 7500: ${from7500.length} (${from7500[0]} .. ${from7500[from7500.length - 1]})`);

  const newWords = [...new Set([...from3000, ...from7500])];
  const expanded = [...new Set([...answers, ...newWords])].sort();

  console.log(`\nNew words added:    ${newWords.length}`);
  console.log(`Final answer count: ${expanded.length}`);

  fs.writeFileSync(ANSWERS_PATH, expanded.join('\n') + '\n', 'utf-8');
  console.log(`✓ Written to ${ANSWERS_PATH}`);
}

main();
