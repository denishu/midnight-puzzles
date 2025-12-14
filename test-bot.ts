import { DiscordClient, DiscordClientConfig } from './core/discord/DiscordClient';
import { InteractionHandler } from './core/discord/InteractionHandler';
import { MessageFormatter } from './core/discord/MessageFormatter';
import { EmbedBuilder } from './core/discord/EmbedBuilder';
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Simple test bot to demonstrate Discord integration layer
 * This bot creates a few test commands to showcase the functionality
 */
class TestBot {
  private discordClient: DiscordClient;
  private interactionHandler: InteractionHandler;

  constructor() {
    // Configure the Discord client
    const config: DiscordClientConfig = {
      token: process.env.DISCORD_TOKEN || '',
      clientId: process.env.DISCORD_CLIENT_ID || '',
      guildId: process.env.DISCORD_GUILD_ID // Optional - for faster command deployment during testing
    };

    this.discordClient = new DiscordClient(config);
    this.interactionHandler = new InteractionHandler();
    
    this.setupCommands();
    this.setupEventHandlers();
  }

  /**
   * Set up test commands to demonstrate the integration layer
   */
  private setupCommands(): void {
    // Test command 1: Basic ping command
    const pingCommand = {
      data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Test the bot response time'),
      execute: async (interaction: ChatInputCommandInteraction) => {
        const message = MessageFormatter.formatSuccess(
          'Pong!', 
          `Bot is working! Latency: ${Date.now() - interaction.createdTimestamp}ms`
        );
        await interaction.reply(MessageFormatter.toInteractionReply(message));
      }
    };

    // Test command 2: Embed showcase
    const embedCommand = {
      data: new SlashCommandBuilder()
        .setName('embed-test')
        .setDescription('Test different embed types'),
      execute: async (interaction: ChatInputCommandInteraction) => {
        const embed = EmbedBuilder.createGameEmbed(
          'semantle',
          '🎮 Discord Integration Test',
          'This embed demonstrates the EmbedBuilder functionality!'
        );

        embed.addFields(
          { name: 'Component', value: 'EmbedBuilder', inline: true },
          { name: 'Status', value: '✅ Working', inline: true },
          { name: 'Test Type', value: 'Integration Test', inline: true }
        );

        await interaction.reply({ embeds: [embed] });
      }
    };

    // Test command 3: Message formatter showcase
    const formatCommand = {
      data: new SlashCommandBuilder()
        .setName('format-test')
        .setDescription('Test message formatting features'),
      execute: async (interaction: ChatInputCommandInteraction) => {
        const gameResult = {
          gameType: 'Test Game',
          isComplete: true,
          attempts: 5,
          maxAttempts: 10,
          timeTaken: 120000, // 2 minutes
          score: 85
        };

        const message = MessageFormatter.formatGameComplete(gameResult);
        await interaction.reply(MessageFormatter.toInteractionReply(message));
      }
    };

    // Test command 4: Error handling
    const errorCommand = {
      data: new SlashCommandBuilder()
        .setName('error-test')
        .setDescription('Test error handling'),
      execute: async (interaction: ChatInputCommandInteraction) => {
        const message = MessageFormatter.formatError(
          'Test Error',
          'This is a demonstration of error message formatting.'
        );
        await interaction.reply(MessageFormatter.toInteractionReply(message));
      }
    };

    // Register all commands
    this.discordClient.registerCommand(pingCommand);
    this.discordClient.registerCommand(embedCommand);
    this.discordClient.registerCommand(formatCommand);
    this.discordClient.registerCommand(errorCommand);

    // Register command handlers with the interaction handler
    this.interactionHandler.registerCommandHandler('ping', pingCommand);
    this.interactionHandler.registerCommandHandler('embed-test', embedCommand);
    this.interactionHandler.registerCommandHandler('format-test', formatCommand);
    this.interactionHandler.registerCommandHandler('error-test', errorCommand);
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    const client = this.discordClient.getClient();
    
    // Handle interactions through our interaction handler
    client.on('interactionCreate', async (interaction) => {
      await this.interactionHandler.handleInteraction(interaction);
    });
  }

  /**
   * Start the test bot
   */
  async start(): Promise<void> {
    try {
      console.log('🤖 Starting Discord Integration Test Bot...');
      
      // Initialize the Discord client
      await this.discordClient.initialize();
      
      // Deploy commands
      console.log('📤 Deploying test commands...');
      await this.discordClient.deployCommands();
      
      console.log('✅ Test bot is ready!');
      console.log('📋 Available test commands:');
      console.log('  /ping - Test basic response');
      console.log('  /embed-test - Test embed creation');
      console.log('  /format-test - Test message formatting');
      console.log('  /error-test - Test error handling');
      console.log('');
      console.log('💡 Try these commands in your Discord server to test the integration layer!');
      
    } catch (error) {
      console.error('❌ Failed to start test bot:', error);
      process.exit(1);
    }
  }

  /**
   * Stop the test bot
   */
  async stop(): Promise<void> {
    console.log('🛑 Stopping test bot...');
    await this.discordClient.shutdown();
    console.log('✅ Test bot stopped.');
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT, shutting down gracefully...');
  if (testBot) {
    await testBot.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
  if (testBot) {
    await testBot.stop();
  }
  process.exit(0);
});

// Start the test bot
let testBot: TestBot;

if (require.main === module) {
  testBot = new TestBot();
  testBot.start().catch(console.error);
}

export default TestBot;