import { CountryGraph } from '../../games/travle/CountryGraph';
import { TravleGame } from '../../games/travle/TravleGame';
import * as readline from 'readline';

async function main() {
  const graph = new CountryGraph();
  await graph.initialize();

  const game = new TravleGame(graph);
  game.init();

  const puzzle = game.genPuzzle(new Date());
  const state = game.newState(puzzle);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise(resolve => rl.question(q, resolve));

  console.log('\n🌍 Travle - Connect the countries!');
  console.log(`Start: ${puzzle.start.toUpperCase()}`);
  console.log(`End:   ${puzzle.end.toUpperCase()}`);
  console.log(`Shortest path: ${puzzle.shortestPathLength} steps`);
  console.log(`Max guesses: ${puzzle.maxGuesses}\n`);

  while (!state.isComplete) {
    const guess = (await ask('Guess a country: ')).trim();
    if (guess.toLowerCase() === 'quit') break;

    const result = game.guess(state, guess);

    const icon = result.status === 'green' ? '🟩'
      : result.status === 'yellow' ? '🟨'
      : result.status === 'red' ? '🟥'
      : '❌';

    console.log(`  ${icon} ${result.feedback}`);

    if (state.guesses.length > 0) {
      const guessLine = state.guesses
        .map(g => {
          const c = g.status === 'green' ? '🟩' : g.status === 'yellow' ? '🟨' : '🟥';
          return `${c} ${g.country}`;
        })
        .join('  |  ');
      console.log(`  Guesses: ${guessLine}`);
    }
    console.log();
  }

  rl.close();
}

main().catch(console.error);
