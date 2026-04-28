#!/usr/bin/env node
/**
 * Duotrigordle Bot - 32 simultaneous Wordle puzzles
 * Entry point for the standalone Duotrigordle Discord bot
 */

import { config } from 'dotenv';
import { BaseBotApplication } from './shared/BaseBotApplication';
import { Logger } from '../core/utils/Logger';
import { GridManager, GRID_COUNT, MAX_GUESSES } from '../games/duotrigordle/GridManager';
import { WordValidator } from '../games/duotrigordle/WordValidator';
import { EmbedBuilder } from '../core/discord/EmbedBuilder';
import { DatabaseConnectionFactory } from '../core/storage/DatabaseConnection';
import { UserRepository } from '../core/storage/UserRepository';
import { GameStateRepository } from '../core/storage/GameStateRepository';
import { ConfigRepository } from '../core/storage/ConfigRepository';
import { MigrationManager } from '../core/storage/migrations/migrate';

// Load environment variables
config();

export class DuotrigordleBot extends BaseBotApplication {
  private validator!: WordValidator;
  private userRepo!: UserRepository;
  private sessionRepo!: GameStateRepository;
  private configRepo!: ConfigRepository;
  // In-memory cache: cleared daily at midnight
  private userSessions: Map<string, string> = new Map();

  constructor() {
    super({
      botName: 'Duotrigordle',
      gameType: 'duotrigordle',
      token: process.env.DUOTRIGORDLE_BOT_TOKEN!,
      clientId: process.env.DUOTRIGORDLE_CLIENT_ID!,
    });
  }

  public async start(): Promise<void> {
    // Initialize database
    const db = await DatabaseConnectionFactory.create({
      type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
      database: process.env.DATABASE_URL || 'duotrigordle-bot.db',
    });
    await new MigrationManager(db).migrate();

    this.userRepo = new UserRepository(db);
    this.sessionRepo = new GameStateRepository(db);
    this.configRepo = new ConfigRepository(db);

    // Initialize word validator and load word lists
    this.validator = new WordValidator();
    this.validator.loadWordLists();
    this.logger.info(`Loaded ${this.validator.answerCount} answers, ${this.validator.guessCount} valid guesses`);

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
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      // Get yesterday's completed games for the recap
      const completedSessions = await this.sessionRepo.getCompletedSessionsForDate('duotrigordle', yesterday);

      // Group by server
      const byServer = new Map<string, Array<typeof completedSessions[0]>>();
      for (const session of completedSessions) {
        const list = byServer.get(session.serverId) || [];
        list.push(session);
        byServer.set(session.serverId, list);
      }

      // Generate today's puzzle for the announcement
      const puzzle = GridManager.generateDailyPuzzle(today, this.validator);

      // Clean up old DB sessions and in-memory cache before posting
      await this.sessionRepo.deleteOldSessions(7);
      this.userSessions.clear();

      // Post to all guilds the bot is in
      for (const guild of this.client.guilds.cache.values()) {
        // Find the designated channel
        const serverConfig = await this.configRepo.getServerConfig(guild.id);
        let channel: any = null;

        if (serverConfig?.channelId) {
          channel = guild.channels.cache.get(serverConfig.channelId);
        }
        if (!channel) {
          channel = guild.systemChannel || guild.channels.cache.find(
            (ch: any) => ch.isTextBased() && ch.permissionsFor(guild.members.me!)?.has('SendMessages')
          );
        }
        if (!channel || !('send' in channel)) continue;

        // --- Yesterday's recap ---
        const serverSessions = byServer.get(guild.id) || [];
        if (serverSessions.length > 0) {
          // Update streak
          const streak = await this.configRepo.getStreak(guild.id, 'duotrigordle');
          const yesterdayStr = yesterday.toISOString().split('T')[0]!;
          const dayBeforeStr = new Date(yesterday.getTime() - 86400000).toISOString().split('T')[0]!;

          const anyWin = serverSessions.some(s => s.result?.isWin);
          let newCount: number;
          if (anyWin) {
            newCount = (streak.lastDate === dayBeforeStr) ? streak.count + 1 : 1;
          } else {
            newCount = 0;
          }
          await this.configRepo.updateStreak(guild.id, 'duotrigordle', newCount, yesterdayStr);

          // Build recap embed
          const recapEmbed = EmbedBuilder.createGameEmbed('duotrigordle', '📝 Yesterday\'s Duotrigordle Recap');
          const lines = serverSessions.map(s => {
            const gridsCompleted = s.result?.gridsCompleted ?? s.gameData?.gridsCompleted ?? 0;
            const guessesUsed = s.result?.guessesUsed ?? s.attempts ?? '?';
            const won = s.result?.isWin;
            const score = won
              ? `✅ Solved ${gridsCompleted}/${GRID_COUNT} in ${guessesUsed}/${MAX_GUESSES} guesses`
              : `❌ ${gridsCompleted}/${GRID_COUNT} grids (${guessesUsed}/${MAX_GUESSES} guesses)`;
            return `**${s.username}** — ${score}`;
          });

          recapEmbed.setDescription(lines.join('\n'));
          if (newCount > 0) {
            recapEmbed.setFooter({ text: `🔥 Server streak: ${newCount} day${newCount > 1 ? 's' : ''}` });
          }

          await (channel as any).send({ embeds: [recapEmbed] });
        }

        // --- Today's new puzzle ---
        const newEmbed = EmbedBuilder.createGameEmbed('duotrigordle', '📝 New Duotrigordle Puzzle!');
        newEmbed.setDescription(
          `${GRID_COUNT} words to solve in ${MAX_GUESSES} guesses!\n\n` +
          'Launch the Activity to play today\'s puzzle. Use `/play` for details.'
        );
        await (channel as any).send({ embeds: [newEmbed] });
      }

      this.logger.info('Daily Duotrigordle puzzle message posted with recap');
    } catch (e) {
      this.logger.error('Failed to post daily message:', e);
    }
  }

  protected registerCommands(): void {
    this.commandRegistry.register({
      name: 'play',
      description: 'Start today\'s Duotrigordle puzzle — solve 32 Wordles at once!',
      handler: this.handlePlayCommand.bind(this),
    });

    this.commandRegistry.register({
      name: 'results',
      description: 'Share your Duotrigordle results',
      handler: this.handleResultsCommand.bind(this),
    });

    this.commandRegistry.register({
      name: 'help',
      description: 'Learn how to play Duotrigordle',
      handler: this.handleHelpCommand.bind(this),
    });

    this.commandRegistry.register({
      name: 'setchannel',
      description: 'Set this channel for daily puzzle messages (admin only)',
      handler: this.handleSetChannelCommand.bind(this),
    });
  }

  private async handlePlayCommand(interaction: any): Promise<void> {
    try {
      await interaction.deferReply({ ephemeral: true });
      await this.userRepo.upsertUser(interaction.user.id, interaction.user.username);

      // Check if user already has a completed session today
      const dbSession = await this.sessionRepo.getActiveSession(interaction.user.id, 'duotrigordle', new Date());

      if (dbSession?.isComplete) {
        const gridsCompleted = dbSession.result?.gridsCompleted ?? dbSession.gameData?.gridsCompleted ?? 0;
        const guessesUsed = dbSession.result?.guessesUsed ?? dbSession.attempts ?? '?';
        const won = dbSession.result?.isWin;
        const embed = EmbedBuilder.createGameEmbed('duotrigordle', '📝 Duotrigordle');
        embed.setDescription(
          won
            ? `You already solved today's puzzle! ✅\n\n${gridsCompleted}/${GRID_COUNT} grids in ${guessesUsed}/${MAX_GUESSES} guesses.`
            : `Today's puzzle is complete.\n\n${gridsCompleted}/${GRID_COUNT} grids solved in ${guessesUsed}/${MAX_GUESSES} guesses.`
        );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      // Generate today's puzzle info for the teaser
      const puzzle = GridManager.generateDailyPuzzle(new Date(), this.validator);
      const embed = EmbedBuilder.createGameEmbed('duotrigordle', '📝 Duotrigordle — Today\'s Puzzle');
      embed.setDescription(
        `**${GRID_COUNT} words** to solve in **${MAX_GUESSES} guesses**!\n\n` +
        'Duotrigordle is played through the Discord Activity.\n' +
        'Launch the Activity from the app launcher to start playing!\n\n' +
        `Today's puzzle has ${puzzle.targetWords.length} unique 5-letter words waiting to be solved.`
      );
      embed.setFooter({ text: 'Use /results after completing the Activity to share your score!' });
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error in /play command:', error);
      const errEmbed = EmbedBuilder.createError('Error', 'Something went wrong. Please try again.');
      await interaction.editReply({ embeds: [errEmbed] });
    }
  }

  private async handleResultsCommand(interaction: any): Promise<void> {
    try {
      await interaction.deferReply({ ephemeral: false }); // Public so others can see

      const dbSession = await this.sessionRepo.getActiveSession(interaction.user.id, 'duotrigordle', new Date());

      if (!dbSession) {
        await interaction.editReply({ content: 'You haven\'t played today\'s puzzle yet. Launch the Activity to play!' });
        return;
      }

      if (!dbSession.isComplete) {
        await interaction.editReply({ content: 'Finish the puzzle in the Activity first before sharing results!' });
        return;
      }

      const gridsCompleted = dbSession.result?.gridsCompleted ?? dbSession.gameData?.gridsCompleted ?? 0;
      const guessesUsed = dbSession.result?.guessesUsed ?? dbSession.attempts ?? '?';
      const won = dbSession.result?.isWin;

      const embed = EmbedBuilder.createGameEmbed('duotrigordle', '📝 Duotrigordle Results');
      const score = won
        ? `✅ Solved ${gridsCompleted}/${GRID_COUNT} in ${guessesUsed}/${MAX_GUESSES} guesses`
        : `${gridsCompleted}/${GRID_COUNT} grids (${guessesUsed}/${MAX_GUESSES} guesses)`;
      embed.setDescription(`**${interaction.user.username}** — ${score}`);
      embed.setFooter({ text: 'Use /play or launch the Activity to try today\'s puzzle!' });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error in /results command:', error);
      const errEmbed = EmbedBuilder.createError('Results unavailable', 'Could not retrieve your results.');
      await interaction.editReply({ embeds: [errEmbed] });
    }
  }

  private async handleHelpCommand(interaction: any): Promise<void> {
    const embed = EmbedBuilder.createHelp(
      'duotrigordle',
      'Solve **32 Wordle puzzles** simultaneously in **37 guesses**!\n\n' +
      'Duotrigordle is played through the Discord Activity — the 32 grids are too large for chat embeds.',
      [
        '`/play` — See today\'s puzzle info and how to launch the Activity',
        '`/results` — Share your completed puzzle results',
        '`/help` — Show this help message',
        '`/setchannel` — Set the channel for daily messages (admin)',
      ]
    );
    embed.addFields({
      name: 'How it works',
      value:
        '1. Launch the Duotrigordle Activity from the app launcher\n' +
        '2. Each guess applies to all 32 grids at once\n' +
        '3. Get color feedback per grid:\n' +
        '   🟩 Green = correct letter, correct position\n' +
        '   🟨 Yellow = correct letter, wrong position\n' +
        '   ⬛ Gray = letter not in word\n' +
        '4. Solve all 32 words within 37 guesses to win!',
      inline: false,
    });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async handleSetChannelCommand(interaction: any): Promise<void> {
    try {
      if (!interaction.memberPermissions?.has('ManageGuild')) {
        await interaction.reply({ content: 'You need the "Manage Server" permission to use this command.', ephemeral: true });
        return;
      }

      const channelId = interaction.channelId;
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
      }

      await this.configRepo.setChannelId(guildId, channelId);
      await interaction.reply({ content: `✅ Daily puzzle messages will now be posted in <#${channelId}>`, ephemeral: true });
    } catch (error) {
      this.logger.error('Error in /setchannel:', error);
      await interaction.reply({ content: 'Something went wrong.', ephemeral: true });
    }
  }
}

// Start the bot if this file is run directly
if (require.main === module) {
  const logger = new Logger('DuotrigordleBot');

  if (!process.env.DUOTRIGORDLE_BOT_TOKEN) {
    logger.error('DUOTRIGORDLE_BOT_TOKEN environment variable is required');
    process.exit(1);
  }

  const bot = new DuotrigordleBot();
  bot.start().catch((error) => {
    logger.error('Failed to start Duotrigordle bot:', error);
    process.exit(1);
  });
}
