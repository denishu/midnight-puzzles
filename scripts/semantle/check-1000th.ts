import { SemanticEngine } from '../../games/semantle/SemanticEngine';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const engine = new SemanticEngine();
  await engine.initialize();

  const newPath = path.join(__dirname, '../../data/dictionaries/target-words-840b.txt');
  const oldPath = path.join(__dirname, '../../data/dictionaries/target-words.txt');
  const filePath = fs.existsSync(newPath) ? newPath : oldPath;
  const targetWords = fs.readFileSync(filePath, 'utf-8')
    .split('\n').map(w => w.trim().toLowerCase()).filter(w => w.length > 0 && !w.startsWith('#'));

  function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  const today = new Date();
  for (let i = 0; i < 5; i++) {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() + i);
    const dateStr = date.toISOString().split('T')[0]!;
    const seed = hashString(dateStr);
    const targetWord = targetWords[seed % targetWords.length]!;

    const data = engine.getSemanticData(targetWord);
    let rank1000sim: number | null = null;
    for (const [word, rank] of data.rankings.entries()) {
      if (rank === 1000) { rank1000sim = data.similarities.get(word) ?? null; break; }
    }

    console.log(`${dateStr} | target: ${targetWord} | 1000th sim: ${rank1000sim ? (rank1000sim * 100).toFixed(2) + '%' : 'N/A'}`);
  }
}

main().catch(console.error);
