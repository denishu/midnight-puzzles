#!/usr/bin/env npx ts-node
/**
 * Preview upcoming puzzle answers for all 3 games.
 * Shows today + the next 5 days.
 *
 * Usage: npx ts-node scripts/preview-puzzles.ts
 */

import { GridManager } from '../games/duotrigordle/GridManager';
import { WordValidator } from '../games/duotrigordle/WordValidator';
import { CountryGraph } from '../games/travle/CountryGraph';
import { TravleGame } from '../games/travle/TravleGame';
import * as fs from 'fs';
import * as path from 'path';

// --- Semantle target word generation (mirrors SemantleGame logic) ---
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getSemantleWord(date: Date, targetWords: string[]): string {
  const dateStr = date.toISOString().split('T')[0]!;
  const seed = hashString(dateStr);
  const index = seed % targetWords.length;
  return targetWords[index]!;
}

// --- Main ---
async function main() {
  const days = 6; // today + 5 more

  // Load Duotrigordle word validator
  const validator = new WordValidator();
  validator.loadWordLists();

  // Load Travle graph
  const graph = new CountryGraph();
  await graph.initialize();
  const travleGame = new TravleGame(graph);
  travleGame.init();

  // Load Semantle target words (must match SemantleGame.loadTargetWords logic)
  const targetWordsPath = path.join(process.cwd(), 'data/dictionaries/target-words-840b.txt');
  const targetWords = fs.readFileSync(targetWordsPath, 'utf-8')
    .split('\n')
    .map(w => w.trim().toLowerCase())
    .filter(w => w.length > 0 && !w.startsWith('#'));

  console.log('\n=== PUZZLE PREVIEW ===\n');

  for (let i = 0; i < days; i++) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() + i);
    const dateStr = date.toISOString().split('T')[0]!;
    const label = i === 0 ? '(TODAY)' : i === 1 ? '(tomorrow)' : '';

    console.log(`--- ${dateStr} ${label} ---`);

    // Semantle
    const semantleWord = getSemantleWord(date, targetWords);
    console.log(`  Semantle: ${semantleWord}`);

    // Travle
    const travlePuzzle = travleGame.genPuzzle(date);
    console.log(`  Travle:   ${travlePuzzle.start} → ${travlePuzzle.end} (${travlePuzzle.shortestPathLength - 1} steps)`);
    console.log(`            Path: ${travlePuzzle.shortestPath.join(' → ')}`);

    // Duotrigordle
    const duoPuzzle = GridManager.generateDailyPuzzle(date, validator);
    console.log(`  Duotrigordle: ${duoPuzzle.targetWords.join(', ')}`);

    console.log('');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
