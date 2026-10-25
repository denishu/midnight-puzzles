#!/usr/bin/env node
import { config } from 'dotenv';
import { BaseBotApplication } from './shared/BaseBotApplication';
import { resolveSendableChannel } from './shared/resolveSendableChannel';
import { Logger } from '../core/utils/Logger';
import { puzzleNumber } from '../core/utils/puzzleNumber';
import { BetweenleGame, BetweenleState, BetweenleWords, MAX_GUESSES, guessesRemaining } from '../games/betweenle';
import { EmbedBuilder } from '../core/discord/EmbedBuilder';
import { DatabaseConnectionFactory } from '../core/storage/DatabaseConnection';
import { UserRepository } from '../core/storage/UserRepository';
import { GameStateRepository } from '../core/storage/GameStateRepository';
import { ConfigRepository } from '../core/storage/ConfigRepository';
import { StreakRepository } from '../core/storage/StreakRepository';
import { updateStreaks, clientGuildResolver } from './shared/updateStreaks';
import { makeStreakHandler } from './shared/streakCommand';
import { MigrationManager } from '../core/storage/migrations/migrate';
// @ts-expect-error node-cron has no type declarations
import cron from 'node-cron';

config();

export class BetweenleBot extends BaseBotApplication {
  private game!: BetweenleGame;
  private userRepo!: UserRepository;
  private sessionRepo!: GameStateRepository;
  private configRepo!: ConfigRepository;
  private streakRepo!: StreakRepository;
  // In-memory cache: userId -> BetweenleState
  private cache: Map<string, BetweenleState> = new Map();

  constructor() {
    super({
      botName: 'Betweenle', gameType: 'betweenle',
      token: process.env.BETWEENLE_BOT_TOKEN!,
      clientId: process.env.BETWEENLE_CLIENT_ID!,
    });
  }

  public async start(): Promise<void> {
    const db = await DatabaseConnectionFactory.create({
      type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
      database: process.env.DATABASE_URL || 'betweenle-bot.db',
    });
    await new MigrationManager(db).migrate();
    this.userRepo = new UserRepository(db);
    this.sessionRepo = new GameStateRepository(db);
    this.configRepo = new ConfigRepository(db);
    this.streakRepo = new StreakRepository(db);

    const words = new BetweenleWords();
    words.loadFromDisk();
    this.logger.info(`Loaded ${words.answersList.length} answers, ${words.size} dictionary words`);
    this.game = new BetweenleGame(words);

    await super.start();
    this.scheduleDailyMessage();
  }

  private scheduleDailyMessage(): void {
    // Stagger after the other three bots (00:01/00:02/00:03) at 00:04 UTC so
    // recaps land in order in shared servers.
    cron.schedule('4 0 * * *', () => {
      this.postDailyPuzzleMessage();
    }, { timezone: 'UTC' });
    this.logger.info('Daily puzzle message scheduled for 00:04 UTC');
  }

  private async postDailyPuzzleMessage(): Promise<void> {
    try {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);

      const completedSessions = await this.sessionRepo.getCompletedSessionsForDate('betweenle', yesterday);
      const byServer = new Map<string, Array<typeof completedSessions[0]>>();
      for (const session of completedSessions) {
        const list = byServer.get(session.serverId) || [];
        list.push(session);
        byServer.set(session.serverId, list);
      }

      // Update persisted streaks BEFORE the purge, membership-gated via REST.
      await updateStreaks('betweenle', this.sessionRepo, this.streakRepo, clientGuildResolver(this.client, this.logger), this.logger);

      // Clean up old DB sessions + in-memory cache.
      await this.sessionRepo.deleteOldSessions(7);
      this.cache.clear();

      for (const guild of this.client.guilds.cache.values()) {
        try {
          const serverConfig = await this.configRepo.getServerConfig(guild.id);
          const configuredChannelId = serverConfig ? this.configRepo.getChannelForGame(serverConfig, 'betweenle') : null;
          const channel = resolveSendableChannel(guild, configuredChannelId, this.logger);
          if (!channel) continue;

          // --- Yesterday's recap ---
          const serverSessions = byServer.get(guild.id) || [];
          if (serverSessions.length > 0) {
            const puzzleNo = puzzleNumber(yesterday);
            const recapEmbed = EmbedBuilder.createGameEmbed('betweenle', `🔤 Yesterday's Recap · Betweenle #${puzzleNo}`);
            const lines = serverSessions.map(s => {
              const won = s.result?.isWin;
              const guessCount = s.result?.guessCount ?? s.gameData?.guesses?.length ?? '?';
              const score = won ? `${s.result?.score ?? '?'}/5` : '❌ DNF';
              return `**${s.username}** — ${score} (${guessCount} guesses)`;
            });
            recapEmbed.setDescription(lines.join('\n'));
            await (channel as any).send({ embeds: [recapEmbed] });
          }

          // --- Today's new puzzle ---
          const newEmbed = EmbedBuilder.createGameEmbed('betweenle', '🔤 New Betweenle Puzzle!');
          newEmbed.setDescription(
            'A new secret word is waiting — find it by alphabetical order!\n\n' +
            'Use `/play` or launch the Activity to start!'
          );
          await (channel as any).send({ embeds: [newEmbed] });
        } catch (guildError) {
          this.logger.error(`Failed to post to guild ${guild.id}:`, guildError);
        }
      }

      this.logger.info('Daily puzzle message posted with recap');
    } catch (e) {
      this.logger.error('Failed to post daily message:', e);
    }
  }

  protected registerCommands(): void {
    this.commandRegistry.register({ name: 'play', description: "Start today's Betweenle puzzle!", handler: this.handlePlay.bind(this) });
    this.commandRegistry.register({ name: 'guess', description: 'Guess a 5-letter word', options: [{ name: 'word', description: '5-letter word', type: 'STRING', required: true }], handler: this.handleGuess.bind(this) });
    this.commandRegistry.register({ name: 'results', description: 'Share your Betweenle results', handler: this.handleResults.bind(this) });
    this.commandRegistry.register({ name: 'help', description: 'Learn how to play Betweenle', handler: this.handleHelp.bind(this) });
    this.commandRegistry.register({ name: 'streak', description: 'See your Betweenle streak and the server record', handler: makeStreakHandler('betweenle', this.streakRepo, this.logger) });
    this.commandRegistry.register({ name: 'setchannel', description: 'Set this channel for daily puzzle messages (admin only)', handler: this.handleSetChannel.bind(this) });
  }

  /** Load or create today's session for a user. */
  private async getSession(userId: string, serverId: string): Promise<BetweenleState> {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    const dbSession = await this.sessionRepo.getActiveSession(userId, 'betweenle', new Date());
    if (dbSession && dbSession.gameData && (dbSession.gameData as any).secret) {
      const state = dbSession.gameData as unknown as BetweenleState;
      this.cache.set(userId, state);
      return state;
    }

    const state = this.game.newState(new Date());
    await this.sessionRepo.createSession({
      userId, serverId, gameType: 'betweenle',
      puzzleDate: new Date(), maxAttempts: MAX_GUESSES,
      gameData: state as any,
    });
    this.cache.set(userId, state);
    return state;
  }

  private async saveState(userId: string, state: BetweenleState): Promise<void> {
    const dbSession = await this.sessionRepo.getActiveSession(userId, 'betweenle', new Date());
    if (dbSession) {
      await this.sessionRepo.updateGameData(dbSession.id, state as any);
      if (state.isComplete) {
        await this.sessionRepo.completeSession(dbSession.id, {
          isWin: state.isWin, guessCount: state.guesses.length, score: state.score,
        });
      }
    }
  }

  /** Render the guess history + bounds for the embed. */
  private buildBoard(state: BetweenleState): string {
    if (state.guesses.length === 0) return 'No guesses yet. Bounds: `aaaaa` … `zzzzz`';
    const lines = state.guesses.map(g => {
      if (g.direction === 'correct') return `✅ **${g.word}** — correct!`;
      const arrow = g.direction === 'before' ? '⬅️ after' : '➡️ before';
      // 'before' means guess is before secret -> secret is AFTER the guess.
      const dir = g.direction === 'before' ? 'secret is AFTER' : 'secret is BEFORE';
      return `\`${g.word}\` — ${dir} (${g.distance}% away)`;
    });
    lines.push(`\nBounds: \`${state.lowerBound}\` … \`${state.upperBound}\``);
    return lines.join('\n');
  }

  private async handlePlay(interaction: any): Promise<void> {
    try {
      await interaction.deferReply({ ephemeral: true });
      await this.userRepo.upsertUser(interaction.user.id, interaction.user.username);
      const state = await this.getSession(interaction.user.id, interaction.guildId ?? 'dm');
      const embed = EmbedBuilder.createGameEmbed('betweenle', '🔤 Betweenle — Find the Word by Alphabet!');
      if (state.isComplete) {
        embed.setDescription(state.isWin
          ? `You already solved today's puzzle in ${state.guesses.length} guesses! Score: ${state.score}/5`
          : `Today's puzzle is over. The word was **${state.secret}**.`);
      } else {
        embed.setDescription(
          'Guess a 5-letter word. Each guess tells you whether the secret is **before** or **after** it alphabetically, and how far (% of the dictionary between).\n\n' +
          this.buildBoard(state)
        );
        embed.setFooter({ text: `Guesses remaining: ${guessesRemaining(state)} / ${MAX_GUESSES} · use /guess <word>` });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error in /play:', error);
      await interaction.editReply({ embeds: [EmbedBuilder.createError('Error', 'Something went wrong.')] });
    }
  }

  private async handleGuess(interaction: any): Promise<void> {
    try {
      await interaction.deferReply({ ephemeral: true });
      await this.userRepo.upsertUser(interaction.user.id, interaction.user.username);
      const state = await this.getSession(interaction.user.id, interaction.guildId ?? 'dm');
      const word = interaction.options.getString('word')?.trim();
      if (!word) { await interaction.editReply({ content: 'Please provide a 5-letter word.' }); return; }

      const outcome = this.game.guess(state, word);
      if (!outcome.ok) { await interaction.editReply({ content: outcome.error }); return; }
      await this.saveState(interaction.user.id, state);

      const embed = EmbedBuilder.createGameEmbed('betweenle', '🔤 Betweenle');
      embed.setDescription(this.buildBoard(state));
      if (state.isComplete) {
        embed.addFields({
          name: state.isWin ? '🎉 Solved!' : '❌ Out of guesses',
          value: state.isWin
            ? `**${state.secret}** in ${state.guesses.length} guesses — score ${state.score}/5`
            : `The word was **${state.secret}**.`,
          inline: false,
        });
      } else {
        embed.setFooter({ text: `Guesses remaining: ${guessesRemaining(state)} / ${MAX_GUESSES}` });
      }
      await interaction.editReply({ embeds: [embed] });

      // Auto-post public results on win.
      if (state.isWin) {
        const puzzleNo = puzzleNumber(new Date());
        const rEmbed = EmbedBuilder.createGameEmbed('betweenle', `🔤 Betweenle #${puzzleNo} Results`);
        rEmbed.setDescription(`**${interaction.user.username}** solved it — ${state.score}/5 (${state.guesses.length} guesses)`);
        await interaction.followUp({ embeds: [rEmbed], ephemeral: false });
      }
    } catch (error) {
      this.logger.error('Error in /guess:', error);
      await interaction.editReply({ embeds: [EmbedBuilder.createError('Error', 'Something went wrong.')] });
    }
  }

  private async handleResults(interaction: any): Promise<void> {
    try {
      await interaction.deferReply({ ephemeral: false });
      let state = this.cache.get(interaction.user.id);
      if (!state) {
        const dbSession = await this.sessionRepo.getActiveSession(interaction.user.id, 'betweenle', new Date());
        if (dbSession && dbSession.gameData && (dbSession.gameData as any).secret) {
          state = dbSession.gameData as unknown as BetweenleState;
          this.cache.set(interaction.user.id, state);
        }
      }
      if (!state) { await interaction.editReply({ content: "You haven't played today. Use `/play` to start!" }); return; }
      if (!state.isComplete) { await interaction.editReply({ content: 'Finish the puzzle first!' }); return; }

      const puzzleNo = puzzleNumber(new Date());
      const embed = EmbedBuilder.createGameEmbed('betweenle', `🔤 Betweenle #${puzzleNo} Results`);
      embed.setDescription(state.isWin
        ? `**${interaction.user.username}** — ${state.score}/5 (${state.guesses.length} guesses)`
        : `**${interaction.user.username}** — DNF`);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error in /results:', error);
      await interaction.editReply({ embeds: [EmbedBuilder.createError('Error', 'Could not get results.')] });
    }
  }

  private async handleHelp(interaction: any): Promise<void> {
    const embed = EmbedBuilder.createHelp('betweenle',
      'Find the daily secret 5-letter word using ALPHABETICAL order (not meaning). Each guess is marked before/after the secret in the dictionary, with a distance showing how close you are. You have 14 guesses.',
      ['`/play` — Start or resume today\'s puzzle', '`/guess crane` — Guess a 5-letter word', '`/results` — Share your results', '`/streak` — See your streak', '`/setchannel` — Set the daily channel (admin)']
    );
    embed.addFields({ name: 'Scoring', value: 'Solve in guesses 1-5 → **5**, 6-8 → **4**, 9-11 → **3**, 12-13 → **2**, 14 → **1**. Earlier is better!', inline: false });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }

  private async handleSetChannel(interaction: any): Promise<void> {
    try {
      if (!interaction.memberPermissions?.has('ManageGuild')) {
        await interaction.reply({ content: 'You need the "Manage Server" permission to use this command.', ephemeral: true });
        return;
      }
      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
        return;
      }
      await this.configRepo.setChannelId(guildId, interaction.channelId, 'betweenle');
      await interaction.reply({ content: `✅ Daily puzzle messages will now be posted in <#${interaction.channelId}>`, ephemeral: true });
    } catch (error) {
      this.logger.error('Error in /setchannel:', error);
      await interaction.reply({ content: 'Something went wrong.', ephemeral: true });
    }
  }
}

if (require.main === module) {
  const logger = new Logger('BetweenleBot');
  if (!process.env.BETWEENLE_BOT_TOKEN) { logger.error('BETWEENLE_BOT_TOKEN required'); process.exit(1); }
  const bot = new BetweenleBot();
  bot.start().catch((e: any) => { logger.error('Failed to start:', e); process.exit(1); });
}
