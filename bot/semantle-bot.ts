#!/usr/bin/env node
/**
 * Semantle Bot - Word similarity guessing game
 * Entry point for the standalone Semantle Discord bot
 */

import { config } from 'dotenv';
import { BaseBotApplication } from './shared/BaseBotApplication';
import { Logger } from '../core/utils/Logger';
import { SemantleGame } from '../games/semantle/SemantleGame';
import { SemanticEngine } from '../games/semantle/SemanticEngine';
import { SessionManager } from '../core/auth/SessionManager';
import { GameSessionFactory } from '../core/auth/GameSessionFactory';
import { GameStateRepository } from '../core/storage/GameStateRepository';
import { DailyPuzzleRepository } from '../core/storage/DailyPuzzleRepository';
import { EmbedBuilder } from '../core/discord/EmbedBuilder';
import { DatabaseConnectionFactory } from '../core/storage/DatabaseConnection';
import { UserRepository } from '../core/storage/UserRepository';
import { MigrationManager } from '../core/storage/migrations/migrate';

// Load environment variables
config();

class SemantleBot extends BaseBotApplication {
  private semantleGame!: SemantleGame;
  private gameFactory!: GameSessionFactory;
  private userRepo!: UserRepository;
  private sessionRepo!: GameStateRepository;
  // Maps userId -> sessionId for the current day
  private userSessions: Map<string, string> = new Map();

  constructor() {
    super({
      botName: 'Semantle',
      gameType: 'semantle',
      token: process.env.SEMANTLE_BOT_TOKEN!,
      clientId: process.env.SEMANTLE_CLIENT_ID!,
    });
  }

  public async start(): Promise<void> {
    // Initialize database first (BaseBotApplication.start() does this, but we need it before game setup)
    const dbConfig = {
      type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
      database: process.env.DATABASE_URL || 'semantle-bot.db',
      ...(process.env.DB_HOST && { host: process.env.DB_HOST }),
      ...(process.env.DB_PORT && { port: parseInt(process.env.DB_PORT) }),
      ...(process.env.DB_USER && { username: process.env.DB_USER }),
      ...(process.env.DB_PASSWORD && { password: process.env.DB_PASSWORD }),
    };

    const db = await DatabaseConnectionFactory.create(dbConfig);

    // Run migrations to ensure schema is up to date
    const migrationManager = new MigrationManager(db);
    await migrationManager.migrate();

    const gameStateRepo = new GameStateRepository(db);
    const dailyPuzzleRepo = new DailyPuzzleRepository(db);
    const sessionManager = new SessionManager(gameStateRepo);
    const semanticEngine = new SemanticEngine();
    this.userRepo = new UserRepository(db);
    this.sessionRepo = gameStateRepo;

    this.semantleGame = new SemantleGame(semanticEngine, sessionManager, dailyPuzzleRepo);
    await this.semantleGame.initialize();

    this.gameFactory = new GameSessionFactory(sessionManager, dailyPuzzleRepo);
    this.gameFactory.registerGame(this.semantleGame);

    await super.start();
    this.scheduleDailyMessage();
  }

  private scheduleDailyMessage(): void {
    // @ts-ignore
    import('node-cron').then((cron: any) => {
      cron.default.schedule('0 0 * * *', () => {
        this.postDailyPuzzleMessage();
      }, { timezone: 'UTC' });
      this.logger.info('Daily puzzle message scheduled for midnight UTC');
    });
  }

  private async postDailyPuzzleMessage(): Promise<void> {
    try {
      const embed = EmbedBuilder.createGameEmbed('semantle', '🔤 New Semantle Puzzle!');
      embed.setDescription('A new word is waiting to be discovered!\n\nUse `/play` to start guessing.');

      for (const guild of this.client.guilds.cache.values()) {
        const channel = guild.systemChannel || guild.channels.cache.find(
          (ch: any) => ch.isTextBased() && ch.permissionsFor(guild.members.me!)?.has('SendMessages')
        );
        if (channel && 'send' in channel) {
          await (channel as any).send({ embeds: [embed] });
        }
      }
      this.logger.info('Daily Semantle puzzle message posted');
    } catch (e) {
      this.logger.error('Failed to post daily message:', e);
    }
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

    this.commandRegistry.register({
      name: 'hint',
      description: 'Get a hint for your current Semantle game',
      handler: this.handleHintCommand.bind(this)
    });

    this.commandRegistry.register({
      name: 'reset',
      description: 'Reset your current Semantle game (for testing)',
      handler: this.handleResetCommand.bind(this)
    });
  }

  private async handlePlayCommand(interaction: any): Promise<void> {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const serverId = interaction.guildId ?? 'dm';

    try {
      await interaction.deferReply({ ephemeral: true });

      // Ensure user exists in DB (required by FK constraint on game_sessions)
      await this.userRepo.upsertUser(userId, username);

      const session = await this.semantleGame.startSession(userId, serverId);
      this.userSessions.set(userId, session.id);

      const guesses = session.gameData.guesses ?? [];
      const isComplete = session.isComplete;

      const embed = EmbedBuilder.createSemantle(
        isComplete ? session.gameData.targetWord : null,
        guesses,
        isComplete
      );

      if (isComplete) {
        embed.setFooter({ text: `You already solved today's puzzle in ${session.attempts} guesses!` });
      } else if (guesses.length > 0) {
        embed.setFooter({ text: `Resuming your session — ${guesses.length} guesses so far. Use /guess <word> to continue.` });
      } else {
        embed.setFooter({ text: 'Use /guess <word> to start guessing!' });
        // Show 1000th word similarity threshold
        const threshold = this.semantleGame.get1000thSimilarity(session.gameData.targetWord);
        if (threshold !== null) {
          embed.addFields({ name: 'Hint', value: `The 1000th most similar word has ${(threshold * 100).toFixed(2)}% similarity`, inline: false });
        }
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error in /play command:', error);
      const errEmbed = EmbedBuilder.createError('Failed to start game', 'Something went wrong. Please try again.');
      await interaction.editReply({ embeds: [errEmbed] });
    }
  }

  private async handleGuessCommand(interaction: any): Promise<void> {
    const userId = interaction.user.id;
    const word = interaction.options.getString('word')?.trim();

    if (!word) {
      await interaction.reply({ content: 'Please provide a word to guess.', ephemeral: true });
      return;
    }

    try {
      await interaction.deferReply({ ephemeral: true });

      // Ensure the user has an active session
      let sessionId = this.userSessions.get(userId);
      if (!sessionId) {
        await this.userRepo.upsertUser(userId, interaction.user.username);
        const session = await this.semantleGame.startSession(userId, interaction.guildId ?? 'dm');
        sessionId = session.id;
        this.userSessions.set(userId, sessionId);
      }

      const result = await this.semantleGame.processGuess(sessionId, word);

      if (result.isComplete && result.data?.result) {
        // Won — show full game state
        const gameState = await this.semantleGame.getGameState(sessionId);
        const guesses = gameState.session.gameData.guesses ?? [];
        const embed = EmbedBuilder.createSemantle(gameState.session.gameData.targetWord, guesses, true);
        embed.setFooter({ text: result.feedback });
        await interaction.editReply({ embeds: [embed] });

        // Auto-post public results
        const session = gameState.session;
        const resultsEmbed = EmbedBuilder.createGameEmbed('semantle', '🔤 Semantle Results');
        resultsEmbed.setDescription(`**${interaction.user.username}** solved today's Semantle in **${session.attempts}** guesses!`);
        if (session.gameData.bestRank) {
          resultsEmbed.addFields({ name: 'Best Rank', value: `#${session.gameData.bestRank}`, inline: true });
        }
        await interaction.followUp({ embeds: [resultsEmbed], ephemeral: false });
      } else {
        // Ongoing — show feedback + recent guesses
        const gameState = await this.semantleGame.getGameState(sessionId);
        const guesses = gameState.session.gameData.guesses ?? [];
        const embed = EmbedBuilder.createSemantle(null, guesses, false);
        embed.setFooter({ text: result.feedback + (result.nextPrompt ? ` | ${result.nextPrompt}` : '') });
        await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      this.logger.error('Error in /guess command:', error);
      const errEmbed = EmbedBuilder.createError('Guess failed', 'Something went wrong processing your guess.');
      await interaction.editReply({ embeds: [errEmbed] });
    }
  }

  private async handleResultsCommand(interaction: any): Promise<void> {
    const userId = interaction.user.id;

    try {
      await interaction.deferReply({ ephemeral: false }); // Public so others can see

      const sessionId = this.userSessions.get(userId);
      if (!sessionId) {
        await interaction.editReply({ content: 'You haven\'t started today\'s puzzle yet. Use `/play` to begin!' });
        return;
      }

      const gameState = await this.semantleGame.getGameState(sessionId);
      const session = gameState.session;
      const guesses: Array<{ word: string; rank?: number; similarity: number }> = session.gameData.guesses ?? [];

      if (!session.isComplete) {
        await interaction.editReply({ content: 'Finish the puzzle first before sharing results!' });
        return;
      }

      const embed = EmbedBuilder.createGameEmbed('semantle', '🔤 Semantle Results');
      embed.setDescription(`**${interaction.user.username}** solved today's Semantle in **${session.attempts}** guesses!`);
      if (session.gameData.bestRank) {
        embed.addFields(
          { name: 'Best Rank', value: `#${session.gameData.bestRank}`, inline: true }
        );
      }
      embed.setFooter({ text: 'Use /play to try today\'s puzzle!' });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error in /results command:', error);
      const errEmbed = EmbedBuilder.createError('Results unavailable', 'Could not retrieve your results.');
      await interaction.editReply({ embeds: [errEmbed] });
    }
  }

  private async handleResetCommand(interaction: any): Promise<void> {
    const userId = interaction.user.id;
    this.userSessions.delete(userId);
    const dbSession = await this.sessionRepo.getActiveSession(userId, 'semantle', new Date());
    if (dbSession) {
      await this.sessionRepo.deleteSession(dbSession.id);
    }
    await interaction.reply({ content: '🔄 Game reset. Use `/play` to start fresh.', ephemeral: true });
  }

  private async handleHintCommand(interaction: any): Promise<void> {
    const userId = interaction.user.id;

    try {
      await interaction.deferReply({ ephemeral: true });

      const sessionId = this.userSessions.get(userId);
      if (!sessionId) {
        await interaction.editReply({ content: 'Start a game first with `/play`!' });
        return;
      }

      const hint = await this.semantleGame.getHint(sessionId);
      if (!hint) {
        await interaction.editReply({ content: 'No hint available — you may have already completed the puzzle.' });
        return;
      }

      const embed = EmbedBuilder.createGameEmbed('semantle', '💡 Hint');
      embed.setDescription(`Try the word **${hint.word}** (rank #${hint.rank})`);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error in /hint command:', error);
      const errEmbed = EmbedBuilder.createError('Hint failed', 'Could not generate a hint.');
      await interaction.editReply({ embeds: [errEmbed] });
    }
  }

  private async handleHelpCommand(interaction: any): Promise<void> {
    const embed = EmbedBuilder.createHelp(
      'semantle',
      'Guess the secret word using **semantic similarity** — how closely related words are in meaning, not spelling.',
      [
        '`/play` — Start or resume today\'s puzzle',
        '`/guess happy` — Guess a word and see how close you are',
        '`/hint` — Get a hint (gives a word closer than your best)',
        '`/results` — Share your completed puzzle results',
      ]
    );
    embed.addFields({
      name: 'How scoring works',
      value: '• Words in the top 1000 most similar get a rank (#1 = closest)\n• Words outside the top 1000 show as ❄️ Cold or 🌡️ Tepid\n• Exact match = you win!',
      inline: false
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
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