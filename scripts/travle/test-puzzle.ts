import { CountryGraph } from '../../games/travle/CountryGraph';
import { PuzzleGenerator } from '../../games/travle/PuzzleGenerator';

async function main() {
  const graph = new CountryGraph();
  await graph.initialize();

  const gen = new PuzzleGenerator(graph);
  gen.initialize();

  // Generate puzzles for the next 7 days
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    const puzzle = gen.generateForDate(date);
    const dateStr = date.toISOString().split('T')[0];
    console.log(`${dateStr}: ${puzzle.start} → ${puzzle.end} (${puzzle.shortestPathLength} steps, ${puzzle.maxGuesses} max guesses)`);
    console.log(`  Path: ${puzzle.shortestPath.join(' → ')}`);
    console.log();
  }
}

main().catch(console.error);
