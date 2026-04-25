import { SemanticEngine } from '../../games/semantle/SemanticEngine';

async function main() {
  const engine = new SemanticEngine();
  await engine.initialize();

  const testWords = ['river', 'ocean', 'forest', 'mountain', 'cloud', 'freedom', 'tiger', 'coffee', 'bridge', 'silence'];

  for (const word of testWords) {
    if (!engine.isValidWord(word)) {
      console.log(`${word}: NOT IN VOCABULARY`);
      continue;
    }

    const data = engine.getSemanticData(word);

    // Find rank 1, 10, 1000 similarities
    let rank1Sim = 0, rank10Sim = 0, rank1000Sim = 0;
    let rank1Word = '', rank10Word = '', rank1000Word = '';
    let maxRank = 0;

    for (const [w, rank] of data.rankings.entries()) {
      const sim = data.similarities.get(w) || 0;
      if (rank === 1) { rank1Sim = sim; rank1Word = w; }
      if (rank === 10) { rank10Sim = sim; rank10Word = w; }
      if (rank === 1000) { rank1000Sim = sim; rank1000Word = w; }
      if (rank > maxRank) maxRank = rank;
    }

    console.log(`\n${word} (${data.rankings.size} ranked words, max rank: ${maxRank}):`);
    console.log(`  #1:    ${rank1Word} = ${(rank1Sim * 100).toFixed(2)}%`);
    console.log(`  #10:   ${rank10Word} = ${(rank10Sim * 100).toFixed(2)}%`);
    console.log(`  #1000: ${rank1000Word} = ${(rank1000Sim * 100).toFixed(2)}%`);
  }

  console.log('\nVocabulary size:', engine.getVocabularySize());
}

main().catch(console.error);
