import { CountryGraph } from '../../games/travle/CountryGraph';
import * as readline from 'readline';

async function main() {
  const graph = new CountryGraph();
  await graph.initialize();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve));

  console.log('\n🌍 Travle Path Finder');
  console.log('Type two country names to find the shortest path.');
  console.log('Type "quit" to exit.\n');

  while (true) {
    const start = (await ask('Start country: ')).trim().toLowerCase();
    if (start === 'quit') break;

    const end = (await ask('End country:   ')).trim().toLowerCase();
    if (end === 'quit') break;

    if (!graph.isValidCountry(start)) {
      console.log(`  ❌ "${start}" not found.\n`);
      continue;
    }
    if (!graph.isValidCountry(end)) {
      console.log(`  ❌ "${end}" not found.\n`);
      continue;
    }

    const path = graph.findShortestPath(start, end);
    if (!path) {
      console.log(`  ❌ No path exists (disconnected countries).\n`);
    } else {
      console.log(`  ✅ ${path.length - 1} steps: ${path.join(' → ')}\n`);
    }
  }

  rl.close();
}

main().catch(console.error);
