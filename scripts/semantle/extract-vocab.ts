/**
 * Extract a filtered vocabulary + binary vectors from the GloVe 840B file.
 * 
 * Reads the 840B file, takes the first N lines, filters for letters-only words,
 * and outputs:
 *   1. vocab.txt — one word per line (the filtered vocabulary)
 *   2. vectors.bin — Float32Array binary file (word vectors in same order as vocab.txt)
 * 
 * Usage: npx ts-node scripts/semantle/extract-vocab.ts
 */

import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

const GLOVE_PATH = path.join(process.env.USERPROFILE || '', 'data', 'glove.840B.300d.txt');
const OUTPUT_DIR = path.join(__dirname, '../../data/dictionaries');
const MAX_LINES = 500000; // Scan first 500k lines to get ~120k clean words
const TARGET_VOCAB = 120000;
const VECTOR_DIM = 300;

async function main() {
  console.log(`Reading ${GLOVE_PATH}...`);
  console.log(`Target: ${TARGET_VOCAB} clean words from first ${MAX_LINES} lines\n`);

  const fileStream = fs.createReadStream(GLOVE_PATH);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const words: string[] = [];
  const vectors: number[][] = [];
  let lineCount = 0;
  let skipped = 0;

  for await (const line of rl) {
    if (words.length >= TARGET_VOCAB) break;
    if (lineCount >= MAX_LINES) break;
    lineCount++;

    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;

    const word = line.substring(0, spaceIdx);

    // Filter: letters only, 2-15 chars, lowercase
    if (!/^[a-z]{2,15}$/.test(word)) {
      skipped++;
      continue;
    }

    const parts = line.substring(spaceIdx + 1).split(' ').map(Number);
    if (parts.length !== VECTOR_DIM || parts.some(isNaN)) {
      skipped++;
      continue;
    }

    words.push(word);
    vectors.push(parts);

    if (words.length % 10000 === 0) {
      console.log(`  ${words.length} words extracted (scanned ${lineCount} lines, skipped ${skipped})...`);
    }
  }

  console.log(`\nExtracted ${words.length} words from ${lineCount} lines (skipped ${skipped})`);

  // Write vocab.txt
  const vocabPath = path.join(OUTPUT_DIR, 'vocab-840b.txt');
  fs.writeFileSync(vocabPath, words.join('\n') + '\n');
  console.log(`Wrote ${vocabPath} (${words.length} words)`);

  // Write vectors.bin as Float32Array
  const vectorsPath = path.join(OUTPUT_DIR, 'vectors-840b.bin');
  const buffer = Buffer.alloc(words.length * VECTOR_DIM * 4); // 4 bytes per float32
  for (let i = 0; i < words.length; i++) {
    for (let j = 0; j < VECTOR_DIM; j++) {
      buffer.writeFloatLE(vectors[i]![j]!, (i * VECTOR_DIM + j) * 4);
    }
  }
  fs.writeFileSync(vectorsPath, buffer);
  const sizeMB = (buffer.length / 1024 / 1024).toFixed(1);
  console.log(`Wrote ${vectorsPath} (${sizeMB} MB)`);

  // Quick stats
  console.log(`\nFirst 10 words: ${words.slice(0, 10).join(', ')}`);
  console.log(`Last 10 words: ${words.slice(-10).join(', ')}`);
}

main().catch(console.error);
