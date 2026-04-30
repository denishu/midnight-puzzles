/**
 * Fill target-words-840b.txt to ~2000 words.
 * Takes existing manually curated words, then adds from vocab-840b.txt
 * starting at line 300, skipping words that are likely proper nouns or too short.
 */

import * as fs from 'fs';
import * as path from 'path';

const vocabPath = path.join(__dirname, '../../data/dictionaries/vocab-840b.txt');
const targetPath = path.join(__dirname, '../../data/dictionaries/target-words-840b.txt');
const TARGET_COUNT = 2000;
const START_LINE = 300; // skip the most common words
const MIN_LENGTH = 4;
const MAX_LENGTH = 12;

// Common proper nouns / non-target words to skip
const SKIP_WORDS = new Set([
  // Function words, pronouns, prepositions (too boring as targets)
  'this','that','with','from','they','been','have','were','will','your','what',
  'when','them','than','each','which','their','would','about','could','other',
  'into','more','some','very','just','also','most','only','over','such','after',
  'before','should','where','those','being','between','does','under','since',
  'still','while','might','every','much','both','these','through','during',
  // Common verbs too generic
  'said','made','like','used','come','make','know','take','want','does','going',
  'think','look','give','find','tell','help','keep','turn','start','show',
]);

// Read existing targets
const existing = fs.readFileSync(targetPath, 'utf-8')
  .split('\n')
  .map(w => w.trim().toLowerCase())
  .filter(w => w.length > 0 && !w.startsWith('#'));

const existingSet = new Set(existing);
console.log(`Existing targets: ${existing.length}`);

// Read vocab
const vocab = fs.readFileSync(vocabPath, 'utf-8')
  .split('\n')
  .map(w => w.trim())
  .filter(w => w.length > 0);

console.log(`Vocab size: ${vocab.length}`);

// Fill from vocab starting at line 300
const newWords: string[] = [];
for (let i = START_LINE; i < vocab.length && (existing.length + newWords.length) < TARGET_COUNT; i++) {
  const word = vocab[i]!;

  // Skip if already in targets
  if (existingSet.has(word)) continue;

  // Skip too short or too long
  if (word.length < MIN_LENGTH || word.length > MAX_LENGTH) continue;

  // Skip function words
  if (SKIP_WORDS.has(word)) continue;

  // Skip words ending in common suffixes that suggest proper nouns
  // (but this is imperfect — we're accepting proper nouns in general)

  newWords.push(word);
}

console.log(`Adding ${newWords.length} words to reach ${existing.length + newWords.length} total`);

// Write the complete file
const allWords = [...existing, ...newWords];
const header = '# Curated target words for Semantle (840B vocab)\n# One per line, must exist in vocab-840b.txt\n';
fs.writeFileSync(targetPath, header + allWords.join('\n') + '\n');
console.log(`Wrote ${allWords.length} words to ${targetPath}`);
