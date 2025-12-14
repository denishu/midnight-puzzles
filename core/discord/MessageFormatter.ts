import { 
  EmbedBuilder as DiscordEmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  StringSelectMenuBuilder,
  ButtonStyle,
  ComponentType,
  InteractionReplyOptions,
  MessageCreateOptions
} from 'discord.js';

export interface GameResult {
  gameType: string;
  isComplete: boolean;
  attempts: number;
  maxAttempts: number;
  timeTaken?: number;
  score?: number;
  additionalData?: Record<string, any>;
}

export interface FormattedMessage {
  content?: string;
  embeds?: DiscordEmbedBuilder[];
  components?: ActionRowBuilder<any>[];
  ephemeral?: boolean;
}

/**
 * Standardizes response formatting across games
 * Provides consistent message formatting for all Discord responses
 */
export class MessageFormatter {
  private static readonly COLORS = {
    SUCCESS: 0x00ff00,
    ERROR: 0xff0000,
    WARNING: 0xffff00,
    INFO: 0x0099ff,
    GAME: 0x9932cc,
    NEUTRAL: 0x95a5a6
  } as const;

  private static readonly EMOJIS = {
    SUCCESS: '✅',
    ERROR: '❌',
    WARNING: '⚠️',
    INFO: 'ℹ️',
    GAME: '🎮',
    LOADING: '⏳',
    TROPHY: '🏆',
    FIRE: '🔥',
    THINKING: '🤔'
  } as const;

  /**
   * Format a game start message
   */
  static formatGameStart(gameType: string, description: string, instructions?: string): FormattedMessage {
    const embed = new DiscordEmbedBuilder()
      .setTitle(`${this.EMOJIS.GAME} ${gameType} - Daily Puzzle`)
      .setDescription(description)
      .setColor(this.COLORS.GAME)
      .setTimestamp();

    if (instructions) {
      embed.addFields({ name: 'How to Play', value: instructions, inline: false });
    }

    return { embeds: [embed] };
  }

  /**
   * Format a game guess response
   */
  static formatGuessResponse(
    gameType: string, 
    feedback: string, 
    isCorrect: boolean = false,
    additionalInfo?: string
  ): FormattedMessage {
    const emoji = isCorrect ? this.EMOJIS.SUCCESS : this.EMOJIS.THINKING;
    const color = isCorrect ? this.COLORS.SUCCESS : this.COLORS.INFO;

    const embed = new DiscordEmbedBuilder()
      .setTitle(`${emoji} ${gameType}`)
      .setDescription(feedback)
      .setColor(color)
      .setTimestamp();

    if (additionalInfo) {
      embed.addFields({ name: 'Additional Info', value: additionalInfo, inline: false });
    }

    return { embeds: [embed] };
  }

  /**
   * Format a game completion message
   */
  static formatGameComplete(result: GameResult): FormattedMessage {
    const { gameType, isComplete, attempts, maxAttempts, timeTaken, score } = result;
    
    const emoji = isComplete ? this.EMOJIS.TROPHY : this.EMOJIS.ERROR;
    const color = isComplete ? this.COLORS.SUCCESS : this.COLORS.ERROR;
    const title = isComplete ? 'Puzzle Completed!' : 'Game Over';

    const embed = new DiscordEmbedBuilder()
      .setTitle(`${emoji} ${gameType} - ${title}`)
      .setColor(color)
      .setTimestamp();

    // Add result fields
    const fields = [
      { name: 'Status', value: isComplete ? 'Completed' : 'Failed', inline: true },
      { name: 'Attempts', value: `${attempts}/${maxAttempts}`, inline: true }
    ];

    if (timeTaken) {
      fields.push({ name: 'Time', value: this.formatTime(timeTaken), inline: true });
    }

    if (score !== undefined) {
      fields.push({ name: 'Score', value: score.toString(), inline: true });
    }

    embed.addFields(fields);

    return { embeds: [embed] };
  }

  /**
   * Format an error message
   */
  static formatError(title: string, message: string, ephemeral: boolean = true): FormattedMessage {
    const embed = new DiscordEmbedBuilder()
      .setTitle(`${this.EMOJIS.ERROR} ${title}`)
      .setDescription(message)
      .setColor(this.COLORS.ERROR)
      .setTimestamp();

    return { embeds: [embed], ephemeral };
  }

  /**
   * Format a success message
   */
  static formatSuccess(title: string, message: string, ephemeral: boolean = false): FormattedMessage {
    const embed = new DiscordEmbedBuilder()
      .setTitle(`${this.EMOJIS.SUCCESS} ${title}`)
      .setDescription(message)
      .setColor(this.COLORS.SUCCESS)
      .setTimestamp();

    return { embeds: [embed], ephemeral };
  }

  /**
   * Format an info message
   */
  static formatInfo(title: string, message: string, ephemeral: boolean = false): FormattedMessage {
    const embed = new DiscordEmbedBuilder()
      .setTitle(`${this.EMOJIS.INFO} ${title}`)
      .setDescription(message)
      .setColor(this.COLORS.INFO)
      .setTimestamp();

    return { embeds: [embed], ephemeral };
  }

  /**
   * Format a loading message
   */
  static formatLoading(message: string = 'Processing...'): FormattedMessage {
    const embed = new DiscordEmbedBuilder()
      .setTitle(`${this.EMOJIS.LOADING} Loading`)
      .setDescription(message)
      .setColor(this.COLORS.NEUTRAL)
      .setTimestamp();

    return { embeds: [embed] };
  }

  /**
   * Format game statistics
   */
  static formatStats(
    gameType: string, 
    stats: Record<string, number | string>,
    title: string = 'Statistics'
  ): FormattedMessage {
    const embed = new DiscordEmbedBuilder()
      .setTitle(`📊 ${gameType} - ${title}`)
      .setColor(this.COLORS.INFO)
      .setTimestamp();

    const fields = Object.entries(stats).map(([key, value]) => ({
      name: key,
      value: value.toString(),
      inline: true
    }));

    embed.addFields(fields);

    return { embeds: [embed] };
  }

  /**
   * Add action buttons to a message
   */
  static addActionButtons(message: FormattedMessage, buttons: Array<{
    customId: string;
    label: string;
    style?: ButtonStyle;
    emoji?: string;
    disabled?: boolean;
  }>): FormattedMessage {
    const actionRow = new ActionRowBuilder<ButtonBuilder>();

    buttons.forEach(button => {
      const btn = new ButtonBuilder()
        .setCustomId(button.customId)
        .setLabel(button.label)
        .setStyle(button.style || ButtonStyle.Primary);

      if (button.emoji) {
        btn.setEmoji(button.emoji);
      }

      if (button.disabled) {
        btn.setDisabled(true);
      }

      actionRow.addComponents(btn);
    });

    return {
      ...message,
      components: [...(message.components || []), actionRow]
    };
  }

  /**
   * Format spoiler text for result sharing
   */
  static formatSpoiler(text: string): string {
    return `||${text}||`;
  }

  /**
   * Format code block
   */
  static formatCodeBlock(text: string, language: string = ''): string {
    return `\`\`\`${language}\n${text}\n\`\`\``;
  }

  /**
   * Format inline code
   */
  static formatInlineCode(text: string): string {
    return `\`${text}\``;
  }

  /**
   * Format time duration in a human-readable format
   */
  private static formatTime(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Convert FormattedMessage to InteractionReplyOptions
   */
  static toInteractionReply(message: FormattedMessage): InteractionReplyOptions {
    const result: InteractionReplyOptions = {
      ephemeral: message.ephemeral || false
    };

    if (message.content !== undefined) {
      result.content = message.content;
    }

    if (message.embeds !== undefined) {
      result.embeds = message.embeds;
    }

    if (message.components !== undefined) {
      result.components = message.components;
    }

    return result;
  }

  /**
   * Convert FormattedMessage to MessageCreateOptions
   */
  static toMessageCreate(message: FormattedMessage): MessageCreateOptions {
    const result: MessageCreateOptions = {};

    if (message.content !== undefined) {
      result.content = message.content;
    }

    if (message.embeds !== undefined) {
      result.embeds = message.embeds;
    }

    if (message.components !== undefined) {
      result.components = message.components;
    }

    return result;
  }
}