#!/usr/bin/env node
import { config } from 'dotenv';
import { BaseBotApplication } from './shared/BaseBotApplication';
import { Logger } from '../core/utils/Logger';
import { CountryGraph } from '../games/travle/CountryGraph';
import { TravleGame, TravleGameState } from '../games/travle/TravleGame';
import { EmbedBuilder } from '../core/discord/EmbedBuilder';
import { DatabaseConnectionFactory, DatabaseConnection } from '../core/storage/DatabaseConnection';
import { UserRepository } from '../core/storage/UserRepository';
import { GameStateRepository } from '../core/storage/GameStateRepository';
import { MigrationManager } from '../core/storage/migrations/migrate';

config();

class TravleBot extends BaseBotApplication {
  private travleGame!: TravleGame;
  private graph!: CountryGraph;
  private userRepo!: UserRepository;
  private sessionRepo!: GameStateRepository;
  // In-memory cache: userId -> TravleGameState
  private cache: Map<string, TravleGameState> = new Map();

  constructor() {
    super({
      botName: 'Travle', gameType: 'travle',
      token: process.env.TRAVLE_BOT_TOKEN!,
      clientId: process.env.TRAVLE_CLIENT_ID!,
    });
  }

  public async start(): Promise<void> {
    const db = await DatabaseConnectionFactory.create({
      type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
      database: process.env.DATABASE_URL || 'travle-bot.db',
    });
    await new MigrationManager(db).migrate();
    this.userRepo = new UserRepository(db);
    this.sessionRepo = new GameStateRepository(db);
    this.graph = new CountryGraph();
    await this.graph.initialize();
    this.travleGame = new TravleGame(this.graph);
    this.travleGame.init();
    await super.start();
  }

  protected registerCommands(): void {
    this.commandRegistry.register({ name: 'play', description: "Start today's Travle puzzle!", handler: this.handlePlay.bind(this) });
    this.commandRegistry.register({ name: 'guess', description: 'Guess a country', options: [{ name: 'country', description: 'Country name', type: 'STRING', required: true }], handler: this.handleGuess.bind(this) });
    this.commandRegistry.register({ name: 'results', description: 'Share your Travle results', handler: this.handleResults.bind(this) });
    this.commandRegistry.register({ name: 'help', description: 'Learn how to play Travle', handler: this.handleHelp.bind(this) });
    this.commandRegistry.register({ name: 'reset', description: 'Reset your current game (testing)', handler: this.handleReset.bind(this) });
  }

  /** Load or create today's session for a user */
  private async getSession(userId: string, serverId: string): Promise<TravleGameState> {
    // Check memory cache
    const cached = this.cache.get(userId);
    if (cached) return cached;

    // Check DB for today's session
    const dbSession = await this.sessionRepo.getActiveSession(userId, 'travle', new Date());
    if (dbSession && dbSession.gameData && dbSession.gameData.puzzle) {
      const state = dbSession.gameData as unknown as TravleGameState;
      this.cache.set(userId, state);
      return state;
    }

    // Create new session
    const puzzle = this.travleGame.genPuzzle(new Date());
    const state = this.travleGame.newState(puzzle);
    await this.sessionRepo.createSession({
      userId, serverId, gameType: 'travle',
      puzzleDate: new Date(), maxAttempts: puzzle.maxGuesses,
      gameData: state as any
    });
    this.cache.set(userId, state);
    return state;
  }

  /** Save current state to DB */
  private async saveState(userId: string, state: TravleGameState): Promise<void> {
    const dbSession = await this.sessionRepo.getActiveSession(userId, 'travle', new Date());
    if (dbSession) {
      await this.sessionRepo.updateGameData(dbSession.id, state as any);
      if (state.isComplete) {
        await this.sessionRepo.completeSession(dbSession.id, {
          isWin: state.isWin, guessCount: state.guesses.length,
          shortestPath: state.puzzle.shortestPathLength
        });
      }
    }
  }

  private buildGuessDisplay(state: TravleGameState): string {
    if (state.guesses.length === 0) return 'No guesses yet.';
    return state.guesses.map((g: { country: string; status: string }) => {
      const icon = g.status === 'green' ? '🟩' : g.status === 'yellow' ? '🟨' : '🟥';
      return icon + ' ' + g.country;
    }).join('\n');
  }

  private async handlePlay(interaction: any): Promise<void> {
    try {
      await interaction.deferReply({ ephemeral: true });
      await this.userRepo.upsertUser(interaction.user.id, interaction.user.username);
      const state = await this.getSession(interaction.user.id, interaction.guildId ?? 'dm');
      const pz = state.puzzle;
      const embed = EmbedBuilder.createGameEmbed('travle', '🌍 Travle - Connect the Countries!');
      if (state.isComplete) {
        embed.setDescription(state.isWin
          ? 'You already solved today\'s puzzle in ' + state.guesses.length + ' guesses!'
          : 'Today\'s puzzle is over. The path was: ' + pz.shortestPath.join(' → '));
      } else {
        embed.setDescription('Connect **' + pz.start.toUpperCase() + '** to **' + pz.end.toUpperCase() + '**');
        embed.addFields(
          { name: 'Shortest path', value: (pz.shortestPathLength - 1) + ' countries to find', inline: true },
          { name: 'Guesses remaining', value: '' + state.guessesRemaining, inline: true }
        );
        if (state.guesses.length > 0) embed.addFields({ name: 'Guesses', value: this.buildGuessDisplay(state), inline: false });
        embed.setFooter({ text: 'Use /guess <country> to guess!' });
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
      const country = interaction.options.getString('country')?.trim();
      if (!country) { await interaction.editReply({ content: 'Please provide a country name.' }); return; }

      const result = this.travleGame.guess(state, country);
      await this.saveState(interaction.user.id, state);

      const icon = result.status === 'green' ? '🟩' : result.status === 'yellow' ? '🟨' : result.status === 'red' ? '🟥' : '❌';
      const embed = EmbedBuilder.createGameEmbed('travle', '🌍 Travle');
      embed.setDescription(icon + ' ' + result.feedback);
      embed.addFields(
        { name: 'Start → End', value: state.puzzle.start.toUpperCase() + ' → ' + state.puzzle.end.toUpperCase(), inline: false },
        { name: 'Guesses', value: this.buildGuessDisplay(state), inline: false }
      );
      if (!state.isComplete) embed.addFields({ name: 'Remaining', value: '' + state.guessesRemaining, inline: true });
      if (result.winningPath) embed.addFields({ name: 'Winning path', value: result.winningPath.join(' → '), inline: false });
      await interaction.editReply({ embeds: [embed] });

      // Auto-post public results on win
      if (result.isWin) {
        const pz = state.puzzle;
        const colors = state.guesses.map((g: { status: string }) => g.status === 'green' ? '🟩' : g.status === 'yellow' ? '🟨' : '🟥').join('');
        const over = state.guesses.length - (pz.shortestPathLength - 1);
        const score = over <= 0 ? 'Perfect!' : '+' + over;
        const rEmbed = EmbedBuilder.createGameEmbed('travle', '🌍 Travle Results');
        rEmbed.setDescription('**' + interaction.user.username + '** — ' + score + '\n' + pz.start.toUpperCase() + ' → ' + pz.end.toUpperCase() + ' (' + state.guesses.length + ' guesses)\n\n' + colors);
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
      const state = this.cache.get(interaction.user.id);
      if (!state) { await interaction.editReply({ content: 'You haven\'t played today. Use `/play` to start!' }); return; }
      if (!state.isComplete) { await interaction.editReply({ content: 'Finish the puzzle first!' }); return; }
      const pz = state.puzzle;
      const colors = state.guesses.map((g: { status: string }) => g.status === 'green' ? '🟩' : g.status === 'yellow' ? '🟨' : '🟥').join('');
      const over = state.guesses.length - (pz.shortestPathLength - 1);
      const score = state.isWin ? (over <= 0 ? 'Perfect!' : '+' + over) : 'DNF';
      const embed = EmbedBuilder.createGameEmbed('travle', '🌍 Travle Results');
      embed.setDescription('**' + interaction.user.username + '** — ' + score + '\n' + pz.start.toUpperCase() + ' → ' + pz.end.toUpperCase() + ' (' + state.guesses.length + ' guesses)\n\n' + colors);
      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      this.logger.error('Error in /results:', error);
      await interaction.editReply({ embeds: [EmbedBuilder.createError('Error', 'Could not get results.')] });
    }
  }

  private async handleReset(interaction: any): Promise<void> {
    this.cache.delete(interaction.user.id);
    const dbSession = await this.sessionRepo.getActiveSession(interaction.user.id, 'travle', new Date());
    if (dbSession) {
      await this.sessionRepo.deleteSession(dbSession.id);
    }
    await interaction.reply({ content: '🔄 Game reset. Use `/play` to start fresh.', ephemeral: true });
  }

  private async handleHelp(interaction: any): Promise<void> {
    const embed = EmbedBuilder.createHelp('travle',
      'Connect two countries by guessing intermediate countries that form a path through land borders.',
      ['`/play` — Start or resume today\'s puzzle', '`/guess france` — Guess a country', '`/results` — Share your results']
    );
    embed.addFields({ name: 'How colors work', value: '🟩 Green — reduced the path cost\n🟨 Yellow — nearby but didn\'t shorten the path\n🟥 Red — far from any useful path', inline: false });
    await interaction.reply({ embeds: [embed], ephemeral: true });
  }
}

if (require.main === module) {
  const logger = new Logger('TravleBot');
  if (!process.env.TRAVLE_BOT_TOKEN) { logger.error('TRAVLE_BOT_TOKEN required'); process.exit(1); }
  const bot = new TravleBot();
  bot.start().catch((e: any) => { logger.error('Failed to start:', e); process.exit(1); });
}
