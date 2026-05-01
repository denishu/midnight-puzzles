import { SemanticEngine } from './SemanticEngine';
import * as readline from 'readline';

/**
 * Interactive Semantle Practice Program
 * 
 * This program lets you:
 * 1. Choose a target word
 * 2. Guess words and see their similarity rankings
 * 3. Practice understanding semantic relationships
 */
class SemanticPractice {
  private engine: SemanticEngine;
  private rl: readline.Interface;
  private targetWord: string = '';
  private guessHistory: Array<{word: string, rank: number | null, similarity: number}> = [];

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
    console.log('🧠 Loading semantic engine...');
    await this.engine.initialize();
    console.log('✅ Semantic engine ready!\n');
  }

  /**
   * Start the interactive session
   */
  async start(): Promise<void> {
    await this.initialize();
    
    console.log('🎯 Welcome to Semantle Practice!');
    console.log('Commands:');
    console.log('  - Type a word to see its similarity ranking');
    console.log('  - "target <word>" to set a new target word');
    console.log('  - "hint" to see the top 5 most similar words');
    console.log('  - "history" to see your guess history');
    console.log('  - "quit" to exit\n');
    
    // Set initial target word
    await this.setRandomTarget();
    
    // Start the main game loop
    this.gameLoop();
  }

  /**
   * Main game loop - handles user input
   */
  private gameLoop(): void {
    this.rl.question('> ', async (input) => {
      const command = input.trim().toLowerCase();
      
      if (command === 'quit' || command === 'exit') {
        this.quit();
        return;
      }
      
      if (command.startsWith('target ')) {
        const newTarget = command.substring(7).trim(); // Extract word after "target "
        if (newTarget.length > 0) {
          await this.setTarget(newTarget);
        } else {
          console.log('Please specify a target word: target <word>');
        }
        
      } else if (command === 'hint') {
        this.showHint();
        
      } else if (command === 'history') {
        this.showHistory();
        
      } else if (command.length > 0) {
        await this.processGuess(command);
        
      }
      
      // Continue the game loop
      this.gameLoop();
    });
  }

  /**
   * Set a random target word from common words
   */
  private async setRandomTarget(): Promise<void> {
    const commonWords = ['cat', 'house', 'water', 'book', 'car', 'tree', 'music', 'food'];
    const randomWord = commonWords[Math.floor(Math.random() * commonWords.length)]!;
    await this.setTarget(randomWord);
  }

  /**
   * Set a specific target word
   */
  private async setTarget(word: string): Promise<void> {
    // TODO: Implement setting the target word
    // Steps:
    // 1. Check if the word is valid using this.engine.isValidWord()
    // 2. If valid, set this.targetWord = word.toLowerCase()
    // 3. Clear the guess history: this.guessHistory = []
    // 4. Print a message about the new target
    // 5. If invalid, print an error message
    if (this.engine.isValidWord(word)) {
        this.targetWord = word.toLowerCase()
        this.guessHistory = []
        console.log(`🎯 Target word set! Start guessing words similar to "${this.targetWord}"`);
    } else {
        console.log(`Target word "${word}" is not in the dictionary - try again!`)
    }
  }

  /**
   * Process a word guess and show its ranking
   */
  private async processGuess(guessWord: string): Promise<void> {
    // TODO: Implement processing a guess
    // Steps:
    // 1. Check if the guess word is valid
    // 2. Get the rank using this.engine.getWordRank(this.targetWord, guessWord)
    // 3. Calculate similarity using this.engine.calculateSimilarity(this.targetWord, guessWord)
    // 4. Add to guess history
    // 5. Display the result with appropriate emoji/message
    // 6. Check if it's the exact target word (winning condition)
    if (this.engine.isValidWord(guessWord)) {
        if (guessWord.toLowerCase() === this.targetWord) {
            console.log("🎉 Congratulations! You found the target word!");
            return;
        }
        const rank = this.engine.getWordRank(this.targetWord, guessWord)
        const similarity = this.engine.calculateSimilarity(this.targetWord, guessWord)
        this.guessHistory.push({word: guessWord, rank: rank, similarity: similarity})
        console.log(this.formatResult(guessWord, rank, similarity))
    } else {
        console.log("This is not a word in the dictionary! Try again!")
    }
  }

  /**
   * Show hint - the top 5 most similar words
   */
  private showHint(): void {
    console.log(`💡 Hint: Top 5 words most similar to "${this.targetWord}":`);
    
    const semanticData = this.engine.getSemanticData(this.targetWord);
    
    // Convert rankings to array and sort by rank (lowest = best)
    const sortedWords = Array.from(semanticData.rankings.entries())
      .sort((a, b) => a[1] - b[1])  // Sort by rank (ascending)
      .slice(0, 5);  // Top 5 only
    
    sortedWords.forEach(([word, rank], index) => {
      const similarity = semanticData.similarities.get(word) || 0;
      console.log(`  ${index + 1}. "${word}" - Rank #${rank} (similarity: ${similarity.toFixed(3)})`);
    });
    
    console.log('');
  }

  /**
   * Show the guess history
   */
  private showHistory(): void {
    // TODO: Implement showing guess history
    // Steps:
    // 1. Check if there are any guesses
    // 2. Sort guesses by rank (best first)
    // 3. Display each guess with rank and similarity
    if (this.guessHistory.length === 0) {
        console.log("No guesses yet!")
        return
    } 
    
    const sortedHistory = this.guessHistory.sort((a, b) => {   
        if (a.rank === null && b.rank === null) return 0;  
        if (a.rank === null) return 1;
        if (b.rank === null) return -1;
        return a.rank - b.rank;
    });

    sortedHistory.forEach((guess, index) => {
        console.log(`${index + 1}. "${guess.word}" - Rank "${guess.rank}": "${guess.similarity}" similarity score`)
    })
}

  

  /**
   * Format the result message based on rank
   */
  private formatResult(word: string, rank: number | null, similarity: number): string {
    // TODO: Implement result formatting
    // Return different messages based on rank:
    // - null or > 1000: "🧊 Cold! Not in top 1000"
    // - 1-10: "🔥 Very Hot! Rank #X"
    // - 11-100: "🌡️ Hot! Rank #X" 
    // - 101-500: "🌤️ Warm! Rank #X"
    // - 501-1000: "❄️ Cool! Rank #X"
    if (rank === null) {
        return "🧊 Cold! Not in top 1000";
    } else if (rank >= 1 && rank <= 10) {
        return `🔥 Very Hot! Rank #${rank} (similarity: ${similarity.toFixed(3)})`;
    } else if (rank >= 11 && rank <= 100) {
        return `🌡️ Hot! Rank #${rank} (similarity: ${similarity.toFixed(3)})`;
    } else if (rank >= 101 && rank <= 500) {
        return `🌤️ Warm! Rank #${rank} (similarity: ${similarity.toFixed(3)})`;
    } else if (rank >= 501 && rank <= 1000) {
        return `❄️ Cool! Rank #${rank} (similarity: ${similarity.toFixed(3)})`;
    }
    
    return `Result for "${word}"`;
  }

  /**
   * Quit the program
   */
  private quit(): void {
    console.log('\n👋 Thanks for playing Semantle Practice!');
    this.rl.close();
  }
}

// Run the program
async function main() {
  const practice = new SemanticPractice();
  await practice.start();
}

if (require.main === module) {
  main().catch(console.error);
}

export default SemanticPractice;