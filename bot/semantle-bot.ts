#!/usr/bin/env node
/**
 * Semantle Bot - Word similarity guessing game
 * Entry point for the standalone Semantle Discord bot
 */

import { config } from 'dotenv';
import { BaseBotApplication } from './shared/BaseBotApplication';
import { Logger } from '../core/utils/Logger';
// Game modules will be imported when implementing actual game logic in task 2

// Load environment variables
config();

class SemantleBot extends BaseBotApplication {
  constructor() {
    super({
      botName: 'Semantle',
      gameType: 'semantle',
      token: process.env.SEMANTLE_BOT_TOKEN!,
      clientId: process.env.SEMANTLE_CLIENT_ID!,
    });
  }

  protected registerCommands(): void {
    this.commandRegistry.register({
      name: 'play',
      description: 'Start today\'s Semantle puzzle - guess the word using semantic similarity!',
      handler: this.handlePlayCommand.bind(this)
    });

    this.commandRegistry.register({
      name: 'guess',
      description: 'Make a guess in your current Semantle game',
      options: [{
        name: 'word',
        description: 'The word you want to guess',
        type: 'STRING',
        required: true
      }],
      handler: this.handleGuessCommand.bind(this)
    });

    this.commandRegistry.register({
      name: 'results',
      description: 'Share your Semantle results',
      handler: this.handleResultsCommand.bind(this)
    });

    this.commandRegistry.register({
      name: 'help',
      description: 'Learn how to play Semantle',
      handler: this.handleHelpCommand.bind(this)
    });
  }

  private async handlePlayCommand(interaction: any): Promise<void> {
    // Implementation will be added in task 2
    await interaction.reply({
      content: '🎯 Starting your Semantle puzzle! (Implementation coming in task 2)',
      ephemeral: true
    });
  }

  private async handleGuessCommand(interaction: any): Promise<void> {
    // Implementation will be added in task 2
    const word = interaction.options.getString('word');
    await interaction.reply({
      content: `🤔 Checking similarity for "${word}"... (Implementation coming in task 2)`,
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
      content: `# 🎯 How to Play Semantle

**Goal:** Guess the secret word using semantic similarity!

**Commands:**
• \`/play\` - Start today's puzzle
• \`/guess <word>\` - Make a guess
• \`/results\` - Share your results

**How it works:**
1. Guess any word
2. Get a similarity score (higher = closer meaning)
3. Words in the top 1000 most similar get a rank number
4. Use the clues to find the target word!

**Tips:**
• Think about word meanings, not spelling
• "Hot" and "warm" are more similar than "hot" and "hit"
• Use your rank clues to narrow down the semantic space

Good luck! 🧠✨`,
      ephemeral: true
    });
  }
}

// Start the bot if this file is run directly
if (require.main === module) {
  const logger = new Logger('SemantleBot');
  
  if (!process.env.SEMANTLE_BOT_TOKEN) {
    logger.error('SEMANTLE_BOT_TOKEN environment variable is required');
    process.exit(1);
  }

  const bot = new SemantleBot();
  bot.start().catch((error) => {
    logger.error('Failed to start Semantle bot:', error);
    process.exit(1);
  });
}