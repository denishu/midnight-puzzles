/**
 * Expand wordle-answers.txt by pulling words from wordle-valid-guesses.txt.
 *
 * Strategy:
 *   1. Load both files
 *   2. Find words in valid-guesses that are NOT already in answers
 *   3. Filter out profanity / offensive words
 *   4. Take the first 1000 from the top of the candidates list
 *   5. Take the last 1000 from the bottom of the candidates list
 *   6. Take 500 from the middle of whatever remains after steps 4-5
 *   7. Take 300 starting from candidate index 3000
 *   8. Take 300 starting from candidate index 7500
 *   9. Merge into answers, sort alphabetically, write back
 *
 * Usage: npx ts-node scripts/duotrigordle/expand-answers.ts
 */

import * as fs from 'fs';
import * as path from 'path';

// --- Profanity blocklist ---------------------------------------------------
// Words that should never appear as a puzzle target in a Discord server.
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

// ---------------------------------------------------------------------------

const DICT_DIR = path.join(__dirname, '../../data/dictionaries');
const ANSWERS_PATH = path.join(DICT_DIR, 'wordle-answers.txt');
const GUESSES_PATH = path.join(DICT_DIR, 'wordle-valid-guesses.txt');

function readWords(filePath: string): string[] {
  return fs
    .readFileSync(filePath, 'utf-8')
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

  // Candidates = words in guesses but NOT in answers, minus profanity
  const candidates = guesses.filter(
    w => !answersSet.has(w) && !PROFANITY.has(w),
  );

  console.log(`Candidates (guesses - answers - profanity): ${candidates.length}`);

  // Step 1: first 1000 from top
  const fromTop = candidates.slice(0, 1000);

  // Step 2: last 1000 from bottom
  const fromBottom = candidates.slice(-1000);

  // Collect what we've already taken (some might overlap if candidates < 2000)
  const taken = new Set([...fromTop, ...fromBottom]);

  // Step 3: 500 from the middle of the remaining candidates
  const remaining = candidates.filter(w => !taken.has(w));
  const midStart = Math.floor(remaining.length / 2) - 250;
  const fromMiddle = remaining.slice(Math.max(0, midStart), Math.max(0, midStart) + 500);

  // Step 4: 300 starting from candidate index 3000
  const from3000 = candidates.slice(3000, 3300).filter(w => !taken.has(w) && !new Set(fromMiddle).has(w));

  // Step 5: 300 starting from candidate index 7500
  const takenSoFar = new Set([...taken, ...fromMiddle, ...from3000]);
  const from7500 = candidates.slice(7500, 7800).filter(w => !takenSoFar.has(w));

  // Merge everything
  const newWords = new Set([...fromTop, ...fromBottom, ...fromMiddle, ...from3000, ...from7500]);
  const expanded = new Set([...answers, ...newWords]);

  // Sort alphabetically
  const sorted = [...expanded].sort();

  console.log(`\nAdded from top:      ${fromTop.length}`);
  console.log(`Added from bottom:   ${fromBottom.length}`);
  console.log(`Added from middle:   ${fromMiddle.length}`);
  console.log(`Added from ~3000:    ${from3000.length}`);
  console.log(`Added from ~7500:    ${from7500.length}`);
  console.log(`New words added:     ${newWords.size}`);
  console.log(`Final answer count:  ${sorted.length}`);

  // Also check if any profanity slipped through from the original answers
  const profanityInOriginal = answers.filter(w => PROFANITY.has(w));
  if (profanityInOriginal.length > 0) {
    console.log(`\n⚠ Profanity found in original answers (removing): ${profanityInOriginal.join(', ')}`);
    const cleaned = sorted.filter(w => !PROFANITY.has(w));
    fs.writeFileSync(ANSWERS_PATH, cleaned.join('\n') + '\n', 'utf-8');
    console.log(`Final count after profanity removal: ${cleaned.length}`);
  } else {
    fs.writeFileSync(ANSWERS_PATH, sorted.join('\n') + '\n', 'utf-8');
  }

  console.log(`\n✓ Written to ${ANSWERS_PATH}`);
}

main();
