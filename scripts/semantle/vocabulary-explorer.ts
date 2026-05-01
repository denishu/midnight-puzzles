import { SemanticEngine } from '../../games/semantle/SemanticEngine';
import * as readline from 'readline';

/**
 * Interactive Vocabulary Explorer
 * 
 * This tool lets you:
 * 1. Check if any word is in the GloVe vocabulary
 * 2. See the frequency ranking (position in GloVe file)
 * 3. Explore vocabulary coverage
 */
class VocabularyExplorer {
  private engine: SemanticEngine;
  private rl: readline.Interface;

  constructor() {
    this.engine = new SemanticEngine();
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  /**
   * Initialize the semantic engine
   */
  async initialize(): Promise<void> {
    console.log('📚 Loading vocabulary (100,000 words)...');
    await this.engine.initialize();
    console.log('✅ Vocabulary loaded!\n');
  }

  /**
   * Start the interactive session
   */
  async start(): Promise<void> {
    await this.initialize();
    
    console.log('🔍 Vocabulary Explorer');
    console.log('Commands:');
    console.log('  - Type any word to check if it\'s in the vocabulary');
    console.log('  - "stats" to see vocabulary statistics');
    console.log('  - "random" to see 10 random words and their rankings');
    console.log('  - "quit" to exit\n');
    
    console.log(`📊 Total vocabulary: ${this.engine.getVocabularySize().toLocaleString()} words`);
    console.log('💡 Lower frequency rank = more common word (rank 1 = most common)\n');
    
    // Start the main loop
    this.explorerLoop();
  }

  /**
   * Main explorer loop - handles user input
   */
  private explorerLoop(): void {
    this.rl.question('> ', async (input) => {
      const command = input.trim().toLowerCase();
      
      if (command === 'quit' || command === 'exit') {
        this.quit();
        return;
      }
      
      if (command === 'stats') {
        this.showStats();
      } else if (command === 'random') {
        this.showRandomWords();
      } else if (command.length > 0) {
        this.checkWord(command);
      }
      
      // Continue the loop
      this.explorerLoop();
    });
  }

  /**
   * Check if a word is in the vocabulary and show its ranking
   */
  private checkWord(word: string): void {
    const isValid = this.engine.isValidWord(word);
    
    if (isValid) {
      const frequencyRank = this.engine.getWordFrequencyRank(word);
      const rankText = frequencyRank ? `#${frequencyRank.toLocaleString()}` : 'Unknown';
      
      let categoryText = '';
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
      }
      
      console.log(`✅ "${word}" is in vocabulary`);
      console.log(`   Frequency rank: ${rankText} out of ${this.engine.getVocabularySize().toLocaleString()}`);
      if (categoryText) {
        console.log(`   Category: ${categoryText}`);
      }
    } else {
      console.log(`❌ "${word}" is NOT in vocabulary`);
      console.log('   This word is not in the top 100,000 most common English words');
    }
    
    console.log('');
  }

  /**
   * Show vocabulary statistics
   */
  private showStats(): void {
    const totalWords = this.engine.getVocabularySize();
    
    console.log('📊 Vocabulary Statistics:');
    console.log(`   Total words: ${totalWords.toLocaleString()}`);
    console.log(`   Source: GloVe 6B 300d embeddings`);
    console.log(`   Coverage: Top ${totalWords.toLocaleString()} most frequent English words`);
    console.log('');
    console.log('📈 Frequency Categories:');
    console.log('   🔥 Very Common: Ranks 1-1,000 (everyday words)');
    console.log('   🌡️ Common: Ranks 1,001-10,000 (well-known words)');
    console.log('   🌤️ Moderately Common: Ranks 10,001-50,000 (familiar words)');
    console.log('   ❄️ Less Common: Ranks 50,001-100,000 (specialized words)');
    console.log('');
  }

  /**
   * Show random words and their rankings
   */
  private showRandomWords(): void {
    console.log('🎲 Random vocabulary sample:');
    
    // Get some example words at different frequency levels
    const examples = [
      { word: 'the', expectedRank: 1 },
      { word: 'tree', expectedRank: 'low' },
      { word: 'house', expectedRank: 'low' },
      { word: 'computer', expectedRank: 'medium' },
      { word: 'elephant', expectedRank: 'medium' },
      { word: 'cockroach', expectedRank: 'high' },
      { word: 'dandelion', expectedRank: 'high' },
      { word: 'cataclysm', expectedRank: 'very high' }
    ];
    
    examples.forEach(({ word }) => {
      if (this.engine.isValidWord(word)) {
        const rank = this.engine.getWordFrequencyRank(word);
        const rankText = rank ? `#${rank.toLocaleString()}` : 'Unknown';
        console.log(`   "${word}" -> Rank ${rankText}`);
      } else {
        console.log(`   "${word}" -> Not in vocabulary`);
      }
    });
    
    console.log('');
  }

  /**
   * Quit the program
   */
  private quit(): void {
    console.log('\n👋 Thanks for exploring the vocabulary!');
    this.rl.close();
  }
}

// Run the program
async function main() {
  const explorer = new VocabularyExplorer();
  await explorer.start();
}

if (require.main === module) {
  main().catch(console.error);
}

export default VocabularyExplorer;