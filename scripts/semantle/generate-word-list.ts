/**
 * Generates a curated target word list from GloVe vectors.
 * Takes the most frequent words and filters out bad candidates.
 * Output: data/dictionaries/target-words.txt
 */

import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';

const VECTORS_PATH = path.join(__dirname, '../../data/dictionaries/semantic-vectors.txt');
const BLACKLIST_PATH = path.join(__dirname, '../../data/dictionaries/proper-nouns-blacklist.txt');
const OUTPUT_PATH = path.join(__dirname, '../../data/dictionaries/target-words.txt');

// How many words to scan from the top of the GloVe file (most frequent first)
const SCAN_LIMIT = 30000;
// Min/max word length for good puzzle words
const MIN_LENGTH = 4;
const MAX_LENGTH = 8;

function loadBlacklist(filePath: string): Set<string> {
  const blacklist = new Set<string>();
  if (!fs.existsSync(filePath)) return blacklist;
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
  for (const line of lines) {
    const word = line.trim().toLowerCase();
    if (word && !word.startsWith('#')) blacklist.add(word);
  }
  return blacklist;
}

function isGoodTargetWord(word: string, blacklist: Set<string>): boolean {
  // Only lowercase letters
  if (!/^[a-z]+$/.test(word)) return false;
  // Length filter — sweet spot for puzzle words
  if (word.length < 4 || word.length > 8) return false;
  // No blacklisted words
  if (blacklist.has(word)) return false;

  // Filter out common function words, pronouns, articles, conjunctions, prepositions
  const stopWords = new Set([
    'that','this','with','from','have','were','they','will','their','after',
    'been','also','would','more','first','about','when','year','than','then',
    'them','some','what','time','into','just','your','like','over','such',
    'even','most','well','back','good','much','know','take','make','come',
    'here','only','very','said','each','does','both','many','same','down',
    'used','long','made','part','away','still','high','every','near','once',
    'upon','whom','whom','whom','thus','else','ever','less','must','need',
    'next','none','once','only','open','over','past','plus','self','sent',
    'show','side','soon','stay','stop','sure','take','tell','than','them',
    'then','they','thus','till','told','took','turn','upon','used','very',
    'want','ways','went','were','what','when','whom','will','with','word',
    'work','year','your','able','also','area','away','back','been','best',
    'both','came','case','come','days','does','done','down','each','else',
    'even','ever','face','fact','feel','find','four','from','full','gave',
    'give','goes','gone','good','hand','hard','have','help','here','high',
    'hold','home','hope','into','just','keep','kind','knew','know','last',
    'late','left','less','life','like','line','live','long','look','made',
    'make','many','mean','meet','mind','miss','more','most','move','much',
    'must','name','near','need','next','none','note','once','only','open',
    'over','part','past','plan','play','plus','pull','push','read','real',
    'rest','said','same','seem','self','sent','show','side','soon','stay',
    'stop','sure','take','tell','them','then','they','till','told','took',
    'true','turn','upon','used','very','want','ways','went','what','when',
    'whom','will','word','work','your','able','area','away','best','came',
    'case','days','done','else','face','fact','feel','find','four','full',
    'gave','give','goes','gone','hand','hard','help','hold','hope','kept',
    'kind','knew','late','left','line','live','look','mean','meet','mind',
    'miss','move','name','note','plan','pull','push','read','rest','seem',
  ]);

  if (stopWords.has(word)) return false;

  return true;
}

async function generate() {
  console.log('Loading blacklist...');
  const blacklist = loadBlacklist(BLACKLIST_PATH);

  console.log(`Scanning first ${SCAN_LIMIT} words from GloVe vectors...`);
  const words: string[] = [];

  const rl = readline.createInterface({
    input: fs.createReadStream(VECTORS_PATH),
    crlfDelay: Infinity
  });

  let lineCount = 0;
  const SKIP_FIRST = 500;  // Skip the most frequent words (function words dominate)
  const SCAN_LIMIT_ACTUAL = 15000; // Stop at 15k — beyond this words get too obscure

  for await (const line of rl) {
    if (lineCount >= SCAN_LIMIT_ACTUAL) break;
    const word = line.split(' ')[0];
    lineCount++;

    if (lineCount <= SKIP_FIRST) continue;

    if (word && isGoodTargetWord(word, blacklist)) {
      words.push(word);
    }
    if (lineCount % 5000 === 0) console.log(`  Scanned ${lineCount}...`);
  }

  console.log(`\nFound ${words.length} candidate words.`);
  fs.writeFileSync(OUTPUT_PATH, words.join('\n'), 'utf-8');
  console.log(`Saved to ${OUTPUT_PATH}`);
  console.log('\nSample words:', words.slice(0, 20).join(', '));
  console.log('...');
  console.log('Around position 1000:', words.slice(990, 1010).join(', '));
}

generate().catch(console.error);
