/**
 * Interactive vocab checker against the 840B vocabulary.
 * Type a word to check if it's in vocab-840b.txt.
 * 
 * Usage: npx ts-node scripts/semantle/check-vocab-840b.ts
 */

import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

const vocabPath = path.join(__dirname, '../../data/dictionaries/vocab-840b.txt');
const words = new Set(fs.readFileSync(vocabPath, 'utf-8').split('\n').map(w => w.trim()).filter(w => w.length > 0));

console.log(`Loaded ${words.size} words from vocab-840b.txt`);
console.log('Type a word to check. Type "quit" to exit.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.on('line', (input) => {
  const word = input.trim().toLowerCase();
  if (word === 'quit' || word === 'exit') { rl.close(); return; }
  if (!word) return;
  if (words.has(word)) {
    console.log(`  ✅ "${word}" is in the vocabulary`);
  } else {
    console.log(`  ❌ "${word}" is NOT in the vocabulary`);
  }
});
