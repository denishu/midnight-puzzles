import { CountryGraph } from '../../games/travle/CountryGraph';
import { PuzzleGenerator } from '../../games/travle/PuzzleGenerator';

async function main() {
  const g = new CountryGraph();
  await g.initialize();
  const gen = new PuzzleGenerator(g);
  gen.initialize();

  for (let i = 0; i < 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const dateStr = d.toISOString().split('T')[0];
    const p = gen.generateForDate(d);
    console.log(`${dateStr}: ${p.start} → ${p.end} (${p.shortestPathLength} steps)`);
  }
}

main().catch(console.error);
