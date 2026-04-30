/**
 * Precompute top-1000 similarity rankings for each target word.
 * 
 * Reads:
 *   - vocab-840b.txt (word list)
 *   - vectors-840b.bin (Float32Array binary vectors)
 *   - target-words-840b.txt (curated target words)
 * 
 * Outputs:
 *   - rankings-840b.json — { targetWord: { word: rank, ... }, ... }
 * 
 * Usage: npx ts-node scripts/semantle/precompute-rankings.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const DICT_DIR = path.join(__dirname, '../../data/dictionaries');
const VECTOR_DIM = 300;
const TOP_K = 1000;

function loadVocab(): string[] {
  const raw = fs.readFileSync(path.join(DICT_DIR, 'vocab-840b.txt'), 'utf-8');
  return raw.split('\n').map(w => w.trim()).filter(w => w.length > 0);
}

function loadVectors(vocabSize: number): Float32Array {
  const buf = fs.readFileSync(path.join(DICT_DIR, 'vectors-840b.bin'));
  return new Float32Array(buf.buffer, buf.byteOffset, vocabSize * VECTOR_DIM);
}

function loadTargets(): string[] {
  const raw = fs.readFileSync(path.join(DICT_DIR, 'target-words-840b.txt'), 'utf-8');
  return raw.split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 0 && !w.startsWith('#'));
}

/** Precompute the magnitude (norm) of each vector for fast cosine similarity */
function precomputeNorms(vectors: Float32Array, count: number): Float32Array {
  const norms = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    let sum = 0;
    const offset = i * VECTOR_DIM;
    for (let j = 0; j < VECTOR_DIM; j++) {
      const v = vectors[offset + j]!;
      sum += v * v;
    }
    norms[i] = Math.sqrt(sum);
  }
  return norms;
}

/** Compute cosine similarity between vector at index a and index b */
function cosineSim(vectors: Float32Array, norms: Float32Array, a: number, b: number): number {
  let dot = 0;
  const offA = a * VECTOR_DIM;
  const offB = b * VECTOR_DIM;
  for (let j = 0; j < VECTOR_DIM; j++) {
    dot += vectors[offA + j]! * vectors[offB + j]!;
  }
  const denom = norms[a]! * norms[b]!;
  return denom === 0 ? 0 : dot / denom;
}

async function main() {
  console.log('Loading vocab...');
  const vocab = loadVocab();
  console.log(`  ${vocab.length} words`);

  console.log('Loading vectors...');
  const vectors = loadVectors(vocab.length);
  console.log(`  ${vectors.length} floats (${(vectors.length * 4 / 1024 / 1024).toFixed(1)} MB)`);

  console.log('Precomputing norms...');
  const norms = precomputeNorms(vectors, vocab.length);

  console.log('Loading targets...');
  const targets = loadTargets();
  console.log(`  ${targets.length} target words\n`);

  // Build word -> index map
  const wordIndex = new Map<string, number>();
  for (let i = 0; i < vocab.length; i++) {
    wordIndex.set(vocab[i]!, i);
  }

  // Check which targets are in vocab
  const validTargets: Array<{ word: string; index: number }> = [];
  let missing = 0;
  for (const word of targets) {
    const idx = wordIndex.get(word);
    if (idx !== undefined) {
      validTargets.push({ word, index: idx });
    } else {
      console.log(`  WARNING: "${word}" not in vocab, skipping`);
      missing++;
    }
  }
  if (missing > 0) console.log(`  ${missing} targets not in vocab\n`);

  // Precompute rankings
  const rankings: Record<string, Record<string, number>> = {};
  const startTime = Date.now();

  for (let t = 0; t < validTargets.length; t++) {
    const target = validTargets[t]!;

    // Compute similarity to all vocab words
    const sims: Array<{ word: string; sim: number }> = [];
    for (let i = 0; i < vocab.length; i++) {
      if (i === target.index) continue; // skip self
      const sim = cosineSim(vectors, norms, target.index, i);
      sims.push({ word: vocab[i]!, sim });
    }

    // Sort descending, take top K
    sims.sort((a, b) => b.sim - a.sim);
    const topK: Record<string, number> = {};
    for (let r = 0; r < Math.min(TOP_K, sims.length); r++) {
      topK[sims[r]!.word] = r + 1; // rank is 1-indexed
    }

    rankings[target.word] = topK;

    if ((t + 1) % 50 === 0 || t === validTargets.length - 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = ((t + 1) / parseFloat(elapsed)).toFixed(1);
      const eta = (((validTargets.length - t - 1) / parseFloat(rate))).toFixed(0);
      console.log(`  ${t + 1}/${validTargets.length} targets (${elapsed}s elapsed, ${rate}/s, ~${eta}s remaining)`);
    }
  }

  // Write output
  const outPath = path.join(DICT_DIR, 'rankings-840b.json');
  fs.writeFileSync(outPath, JSON.stringify(rankings));
  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(1);
  console.log(`\nWrote ${outPath} (${sizeMB} MB, ${Object.keys(rankings).length} targets)`);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Total time: ${totalTime}s`);
}

main().catch(console.error);
