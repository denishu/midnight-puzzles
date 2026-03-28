import { Logger } from '../../core/utils/Logger';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';

/**
 * Unfiltered Semantic Engine - loads ALL words including proper nouns
 * For exploring word frequencies and vocabulary coverage
 */
class UnfilteredSemanticEngine {
  private logger: Logger;
  private vocabulary: Set<string> = new Set();
  private wordPositions: Map<string, number> = new Map();

  constructor() {
    this.logger = new Logger('UnfilteredSemanticEngine');
  }

  async initialize(): Promise<void> {
    this.logger.info('Loading unfiltered vocabulary...');
    await this.loadWordVectors();
    this.logger.info(`Loaded ${this.vocabulary.size} words (no filtering)`);
  }

  private async loadWordVectors(): Promise<void> {
    const filePath = path.join(__dirname, '../../data/dictionaries/semantic-vectors.txt');
    
    const readline = require('readline');
    const fileStream = require('fs').createReadStream(filePath);
    
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    let lineCount = 0;
    const maxWords = 100000;
    
    for await (const line of rl) {
      if (line.trim() && lineCount < maxWords) {
        const parts = line.split(' ');
        const word = parts[0];
        
        // Only check for alphabetic characters, no blacklist filtering
        if (word && parts.length > 1 && /^[a-zA-Z]+$/.test(word)) {
          this.vocabulary.add(word);
          this.wordPositions.set(word, lineCount + 1);
          lineCount++;
          
          if (lineCount % 10000 === 0) {
            this.logger.info(`Loaded ${lineCount} words...`);
          }
        }
      } else if (lineCount >= maxWords) {
        break;
      }
    }
  }

  isValidWord(word: string): boolean {
    return this.vocabulary.has(word.toLowerCase());
  }

  getWordFrequencyRank(word: string): number | null {
    return this.wordPositions.get(word.toLowerCase()) || null;
  }

  getVocabularySize(): number {
    return this.vocabulary.size;
  }
}

/**
 * Interactive Vocabulary Explorer (Unfiltered)
 * 
 * Includes ALL words from GloVe, including proper nouns
 * Perfect for exploring word frequency in English text
 */
class UnfilteredVocabularyExplorer {
  private engine: UnfilteredSemanticEngine;
  private rl: readline.Interface;

  constructor() {
    this.engine = new UnfilteredSemanticEngine();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  async initialize(): Promise<void> {
    console.log('📚 Loading UNFILTERED vocabulary (includes proper nouns)...');
    await this.engine.initialize();
    console.log('✅ Vocabulary loaded!\n');
  }

  async start(): Promise<void> {
    await this.initialize();
    
    console.log('🔍 Unfiltered Vocabulary Explorer');
    console.log('This version includes ALL words, including proper nouns!');
    console.log('Commands:');
    console.log('  - Type any word to check its frequency ranking');
    console.log('  - "stats" to see vocabulary statistics');
    console.log('  - "quit" to exit\n');
    
    console.log(`📊 Total vocabulary: ${this.engine.getVocabularySize().toLocaleString()} words`);
    console.log('💡 Lower frequency rank = more common in English text\n');
    
    this.explorerLoop();
  }

  private explorerLoop(): void {
    this.rl.question('> ', async (input) => {
      const command = input.trim().toLowerCase();
      
      if (command === 'quit' || command === 'exit') {
        this.quit();
        return;
      }
      
      if (command === 'stats') {
        this.showStats();
      } else if (command.length > 0) {
        this.checkWord(command);
      }
      
      this.explorerLoop();
    });
  }

  private checkWord(word: string): void {
    const isValid = this.engine.isValidWord(word);
    
    if (isValid) {
      const frequencyRank = this.engine.getWordFrequencyRank(word);
      const rankText = frequencyRank ? `#${frequencyRank.toLocaleString()}` : 'Unknown';
      
      let categoryText = '';
      let typeHint = '';
      
      if (frequencyRank) {
        if (frequencyRank <= 1000) {
          categoryText = '🔥 Very Common';
        } else if (frequencyRank <= 10000) {
          categoryText = '🌡️ Common';
        } else if (frequencyRank <= 50000) {
          categoryText = '🌤️ Moderately Common';
        } else {
          categoryText = '❄️ Less Common';
        }
        
        // Hint if it might be a proper noun
        if (word[0] === word[0]?.toUpperCase() || frequencyRank > 1000) {
          typeHint = ' (may be a proper noun or specialized term)';
        }
      }
      
      console.log(`✅ "${word}" is in vocabulary`);
      console.log(`   Frequency rank: ${rankText} out of ${this.engine.getVocabularySize().toLocaleString()}`);
      if (categoryText) {
        console.log(`   Category: ${categoryText}${typeHint}`);
      }
    } else {
      console.log(`❌ "${word}" is NOT in vocabulary`);
      console.log('   This word is not in the top 100,000 most common English words');
    }
    
    console.log('');
  }

  private showStats(): void {
    const totalWords = this.engine.getVocabularySize();
    
    console.log('📊 Vocabulary Statistics (Unfiltered):');
    console.log(`   Total words: ${totalWords.toLocaleString()}`);
    console.log(`   Source: GloVe 6B 300d embeddings`);
    console.log(`   Includes: Common words, proper nouns, place names, etc.`);
    console.log('');
    console.log('📈 Frequency Categories:');
    console.log('   🔥 Very Common: Ranks 1-1,000 (everyday words)');
    console.log('   🌡️ Common: Ranks 1,001-10,000 (well-known words)');
    console.log('   🌤️ Moderately Common: Ranks 10,001-50,000 (familiar words)');
    console.log('   ❄️ Less Common: Ranks 50,001-100,000 (specialized/proper nouns)');
    console.log('');
  }

  private quit(): void {
    console.log('\n👋 Thanks for exploring!');
    this.rl.close();
  }
}

// Run the program
async function main() {
  const explorer = new UnfilteredVocabularyExplorer();
  await explorer.start();
}

if (require.main === module) {
  main().catch(console.error);
}

export default UnfilteredVocabularyExplorer;
