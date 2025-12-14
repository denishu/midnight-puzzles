#!/usr/bin/env node
/**
 * Duotrigordle Bot - 32 simultaneous Wordle puzzles
 * Entry point for the standalone Duotrigordle Discord bot
 */

import { config } from 'dotenv';
import { BaseBotApplication } from './shared/BaseBotApplication';
import { Logger } from '../core/utils/Logger';
// Game modules will be imported when implementing actual game logic in task 2

// Load environment variables
config();

class DuotrigordelBot extends BaseBotApplication {
  constructor() {
    super({
      botName: 'Duotrigordle',
      gameType: 'duotrigordle',
      token: process.env.DUOTRIGORDLE_BOT_TOKEN!,
      clientId: process.env.DUOTRIGORDLE_CLIENT_ID!,
    });
  }

  protected registerCommands(): void {
    this.commandRegistry.register({
      name: 'play',
      description: 'Start today\'s Duotrigordle puzzle - solve 32 Wordles at once!',
      handler: this.handlePlayCommand.bind(this)
    });

    this.commandRegistry.register({
      name: 'guess',
      description: 'Submit a 5-letter word guess to all grids',
      options: [{
        name: 'word',
        description: 'Your 5-letter word guess',
        type: 'STRING',
        required: true
      }],
      handler: this.handleGuessCommand.bind(this)
    });

    this.commandRegistry.register({
      name: 'results',
      description: 'Share your Duotrigordle results',
      handler: this.handleResultsCommand.bind(this)
    });

    this.commandRegistry.register({
      name: 'help',
      description: 'Learn how to play Duotrigordle',
      handler: this.handleHelpCommand.bind(this)
    });
  }

  private async handlePlayCommand(interaction: any): Promise<void> {
    // Implementation will be added in task 2
    await interaction.reply({
      content: '🎯 Starting your Duotrigordle puzzle! (Implementation coming in task 2)',
      ephemeral: true
    });
  }

  private async handleGuessCommand(interaction: any): Promise<void> {
    // Implementation will be added in task 2
    const word = interaction.options.getString('word');
    await interaction.reply({
      content: `📝 Applying "${word}" to all 32 grids... (Implementation coming in task 2)`,
      ephemeral: true
    });
  }

  private async handleResultsCommand(interaction: any): Promise<void> {
    // Implementation will be added in task 2
    await interaction.reply({
      content: '📊 Sharing your results... (Implementation coming in task 2)',
      ephemeral: true
    });
  }

  private async handleHelpCommand(interaction: any): Promise<void> {
    await interaction.reply({
      content: `# 🎯 How to Play Duotrigordle

**Goal:** Solve 32 Wordle puzzles simultaneously in 37 guesses!

**Commands:**
• \`/play\` - Start today's puzzle
• \`/guess <word>\` - Submit a 5-letter word
• \`/results\` - Share your results

**How it works:**
1. You have 32 different 5-letter target words
2. Each guess applies to ALL 32 grids at once
3. Get color feedback for each grid:
   • 🟩 Green = correct letter, correct position
   • 🟨 Yellow = correct letter, wrong position  
   • ⬜ Gray = letter not in word
4. Solve all 32 words within 37 total guesses!

**Strategy Tips:**
• Start with words that have common letters (ADIEU, ROAST)
• Focus on grids that need the most help
• Use process of elimination across all grids
• Don't panic - it's challenging but doable!

Good luck with the ultimate word challenge! 🧠💪`,
      ephemeral: true
    });
  }
}

// Start the bot if this file is run directly
if (require.main === module) {
  const logger = new Logger('DuotrigordelBot');
  
  if (!process.env.DUOTRIGORDLE_BOT_TOKEN) {
    logger.error('DUOTRIGORDLE_BOT_TOKEN environment variable is required');
    process.exit(1);
  }

  const bot = new DuotrigordelBot();
  bot.start().catch((error) => {
    logger.error('Failed to start Duotrigordle bot:', error);
    process.exit(1);
  });
}