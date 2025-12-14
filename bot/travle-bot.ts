#!/usr/bin/env node
/**
 * Travle Bot - Geography pathfinding game
 * Entry point for the standalone Travle Discord bot
 */

import { config } from 'dotenv';
import { BaseBotApplication } from './shared/BaseBotApplication';
import { Logger } from '../core/utils/Logger';
// Game modules will be imported when implementing actual game logic in task 2

// Load environment variables
config();

class TravleBot extends BaseBotApplication {
  constructor() {
    super({
      botName: 'Travle',
      gameType: 'travle',
      token: process.env.TRAVLE_BOT_TOKEN!,
      clientId: process.env.TRAVLE_CLIENT_ID!,
    });
  }

  protected registerCommands(): void {
    this.commandRegistry.register({
      name: 'play',
      description: 'Start today\'s Travle puzzle - find the path between two countries!',
      handler: this.handlePlayCommand.bind(this)
    });

    this.commandRegistry.register({
      name: 'guess',
      description: 'Guess the next country in your path',
      options: [{
        name: 'country',
        description: 'The country you want to add to your path',
        type: 'STRING',
        required: true
      }],
      handler: this.handleGuessCommand.bind(this)
    });

    this.commandRegistry.register({
      name: 'results',
      description: 'Share your Travle results',
      handler: this.handleResultsCommand.bind(this)
    });

    this.commandRegistry.register({
      name: 'help',
      description: 'Learn how to play Travle',
      handler: this.handleHelpCommand.bind(this)
    });
  }

  private async handlePlayCommand(interaction: any): Promise<void> {
    // Implementation will be added in task 2
    await interaction.reply({
      content: '🗺️ Starting your Travle puzzle! (Implementation coming in task 2)',
      ephemeral: true
    });
  }

  private async handleGuessCommand(interaction: any): Promise<void> {
    // Implementation will be added in task 2
    const country = interaction.options.getString('country');
    await interaction.reply({
      content: `🌍 Checking path to "${country}"... (Implementation coming in task 2)`,
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
      content: `# 🗺️ How to Play Travle

**Goal:** Find a path between two countries using only land borders!

**Commands:**
• \`/play\` - Start today's puzzle
• \`/guess <country>\` - Add a country to your path
• \`/results\` - Share your results

**How it works:**
1. You'll see a start and end country
2. Guess countries that connect them via land borders
3. Build a path from start to finish
4. Try to do it in as few steps as possible!

**Tips:**
• Only land borders count (no ferries or flights)
• Think about geography and neighboring countries
• Some puzzles have tricky optimal paths
• You have limited guesses, so think carefully!

Good luck exploring! 🧭✨`,
      ephemeral: true
    });
  }
}

// Start the bot if this file is run directly
if (require.main === module) {
  const logger = new Logger('TravleBot');
  
  if (!process.env.TRAVLE_BOT_TOKEN) {
    logger.error('TRAVLE_BOT_TOKEN environment variable is required');
    process.exit(1);
  }

  const bot = new TravleBot();
  bot.start().catch((error) => {
    logger.error('Failed to start Travle bot:', error);
    process.exit(1);
  });
}