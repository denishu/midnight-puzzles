import { EmbedBuilder as DiscordEmbedBuilder, ColorResolvable } from 'discord.js';

export interface GameGridCell {
  value: string;
  status: 'correct' | 'present' | 'absent' | 'empty';
}

export interface GameGrid {
  cells: GameGridCell[][];
  title?: string;
  isComplete?: boolean;
}

export interface GameProgress {
  current: number;
  total: number;
  percentage?: number;
}

/**
 * Creates rich Discord embeds for game interfaces
 * Provides specialized embed creation for different game types and scenarios
 */
export class EmbedBuilder {
  private static readonly GAME_COLORS = {
    semantle: 0x9932cc,
    travle: 0x00aa55,
    duotrigordle: 0xff6b35,
    default: 0x0099ff
  } as const;

  private static readonly STATUS_COLORS = {
    success: 0x00ff00,
    error: 0xff0000,
    warning: 0xffff00,
    info: 0x0099ff,
    neutral: 0x95a5a6
  } as const;

  private static readonly GRID_EMOJIS = {
    correct: '🟩',
    present: '🟨',
    absent: '⬛',
    empty: '⬜'
  } as const;

  /**
   * Create a basic game embed
   */
  static createGameEmbed(
    gameType: string, 
    title: string, 
    description?: string
  ): DiscordEmbedBuilder {
    const color = this.GAME_COLORS[gameType as keyof typeof this.GAME_COLORS] || this.GAME_COLORS.default;
    
    const embed = new DiscordEmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setTimestamp();

    if (description) {
      embed.setDescription(description);
    }

    return embed;
  }

  /**
   * Create an embed for Semantle game display
   */
  static createSemantle(
    targetWord: string | null,
    guesses: Array<{ word: string; rank?: number; similarity: number }>,
    isComplete: boolean = false
  ): DiscordEmbedBuilder {
    const embed = this.createGameEmbed('semantle', '🔤 Semantle - Word Similarity Game');

    if (isComplete && targetWord) {
      embed.setDescription(`🎉 Congratulations! The word was **${targetWord.toUpperCase()}**`);
      embed.setColor(this.STATUS_COLORS.success);
    } else {
      embed.setDescription('Guess words to find the target word using semantic similarity!');
    }

    if (guesses.length > 0) {
      const recentGuesses = guesses.slice(-10); // Show last 10 guesses
      const guessText = recentGuesses
        .map(guess => {
          const rank = guess.rank ? `#${guess.rank}` : 'Cold';
          const similarity = (guess.similarity * 100).toFixed(1);
          return `**${guess.word}** - ${rank} (${similarity}%)`;
        })
        .join('\n');

      embed.addFields({
        name: `Recent Guesses (${guesses.length} total)`,
        value: guessText || 'No guesses yet',
        inline: false
      });
    }

    return embed;
  }

  /**
   * Create an embed for Travle game display
   */
  static createTravle(
    startCountry: string,
    endCountry: string,
    currentPath: string[],
    remainingAttempts: number,
    isComplete: boolean = false
  ): DiscordEmbedBuilder {
    const embed = this.createGameEmbed('travle', '🌍 Travle - Country Path Game');

    if (isComplete) {
      embed.setDescription(`🎉 Success! You connected **${startCountry}** to **${endCountry}**!`);
      embed.setColor(this.STATUS_COLORS.success);
    } else {
      embed.setDescription(`Connect **${startCountry}** to **${endCountry}** through neighboring countries!`);
    }

    if (currentPath.length > 0) {
      const pathText = currentPath.join(' → ');
      embed.addFields({
        name: 'Current Path',
        value: pathText,
        inline: false
      });
    }

    embed.addFields({
      name: 'Remaining Attempts',
      value: remainingAttempts.toString(),
      inline: true
    });

    return embed;
  }

  /**
   * Create an embed for Duotrigordle game display
   */
  static createDuotrigordle(
    grids: GameGrid[],
    completedGrids: number,
    totalGrids: number,
    remainingAttempts: number
  ): DiscordEmbedBuilder {
    const embed = this.createGameEmbed('duotrigordle', '📝 Duotrigordle - 32 Wordle Grids');

    const progress = (completedGrids / totalGrids * 100).toFixed(1);
    embed.setDescription(`Solve all 32 Wordle puzzles! Progress: ${completedGrids}/${totalGrids} (${progress}%)`);

    // Show a summary of grid statuses
    const gridSummary = this.createGridSummary(grids);
    if (gridSummary) {
      embed.addFields({
        name: 'Grid Status',
        value: gridSummary,
        inline: false
      });
    }

    embed.addFields({
      name: 'Remaining Attempts',
      value: remainingAttempts.toString(),
      inline: true
    });

    if (completedGrids === totalGrids) {
      embed.setDescription('🎉 Congratulations! You solved all 32 grids!');
      embed.setColor(this.STATUS_COLORS.success);
    }

    return embed;
  }

  /**
   * Create a visual representation of a Wordle-style grid
   */
  static createWordleGrid(grid: GameGrid): string {
    return grid.cells
      .map(row => 
        row.map(cell => this.GRID_EMOJIS[cell.status] || this.GRID_EMOJIS.empty).join('')
      )
      .join('\n');
  }

  /**
   * Create a progress bar visualization
   */
  static createProgressBar(progress: GameProgress, length: number = 10): string {
    const percentage = progress.percentage || (progress.current / progress.total);
    const filled = Math.round(percentage * length);
    const empty = length - filled;
    
    return '█'.repeat(filled) + '░'.repeat(empty) + ` ${(percentage * 100).toFixed(1)}%`;
  }

  /**
   * Create an embed for game statistics
   */
  static createStatsEmbed(
    gameType: string,
    stats: Record<string, string | number>,
    title: string = 'Statistics'
  ): DiscordEmbedBuilder {
    const embed = this.createGameEmbed(gameType, `📊 ${title}`);

    Object.entries(stats).forEach(([key, value]) => {
      embed.addFields({
        name: key,
        value: value.toString(),
        inline: true
      });
    });

    return embed;
  }

  /**
   * Create an embed for leaderboard display
   */
  static createLeaderboard(
    gameType: string,
    entries: Array<{ rank: number; name: string; score: string; additional?: string }>,
    title: string = 'Leaderboard'
  ): DiscordEmbedBuilder {
    const embed = this.createGameEmbed(gameType, `🏆 ${title}`);

    if (entries.length === 0) {
      embed.setDescription('No entries yet. Be the first to play!');
      return embed;
    }

    const leaderboardText = entries
      .map(entry => {
        const medal = entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : `${entry.rank}.`;
        const additional = entry.additional ? ` (${entry.additional})` : '';
        return `${medal} **${entry.name}** - ${entry.score}${additional}`;
      })
      .join('\n');

    embed.setDescription(leaderboardText);

    return embed;
  }

  /**
   * Create an embed for error messages
   */
  static createError(title: string, message: string, gameType?: string): DiscordEmbedBuilder {
    const embed = new DiscordEmbedBuilder()
      .setTitle(`❌ ${title}`)
      .setDescription(message)
      .setColor(this.STATUS_COLORS.error)
      .setTimestamp();

    return embed;
  }

  /**
   * Create an embed for help/instructions
   */
  static createHelp(
    gameType: string,
    instructions: string,
    examples?: string[]
  ): DiscordEmbedBuilder {
    const embed = this.createGameEmbed(gameType, `❓ How to Play ${gameType.charAt(0).toUpperCase() + gameType.slice(1)}`);
    
    embed.setDescription(instructions);

    if (examples && examples.length > 0) {
      embed.addFields({
        name: 'Examples',
        value: examples.join('\n'),
        inline: false
      });
    }

    return embed;
  }

  /**
   * Create a summary of grid statuses for Duotrigordle
   */
  private static createGridSummary(grids: GameGrid[]): string {
    const completed = grids.filter(g => g.isComplete).length;
    const total = grids.length;
    
    // Create a visual representation of completed vs incomplete grids
    const gridIcons = grids.map(grid => grid.isComplete ? '✅' : '⬜').join('');
    
    // Break into rows of 8 for better display
    const rows = [];
    for (let i = 0; i < gridIcons.length; i += 8) {
      rows.push(gridIcons.slice(i, i + 8));
    }
    
    return rows.join('\n');
  }
}