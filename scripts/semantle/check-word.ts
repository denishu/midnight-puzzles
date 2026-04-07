const fs = require('fs');
const words = fs.readFileSync('data/dictionaries/target-words.txt', 'utf-8').split('\n').map((w: string) => w.trim()).filter((w: string) => w.length > 0);

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h = ((h << 5) - h) + c;
    h = h & h;
  }
  return Math.abs(h);
}

console.log('Total words:', words.length);
console.log('Apr 7 (UTC):', words[hash('2026-04-07') % words.length]);
console.log('Apr 8 (UTC):', words[hash('2026-04-08') % words.length]);
