import { 
  Interaction, 
  ChatInputCommandInteraction, 
  ButtonInteraction, 
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  InteractionType,
  ComponentType
} from 'discord.js';
import { Logger } from '../utils/Logger';

export interface CommandHandler {
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}

export interface ButtonHandler {
  execute(interaction: ButtonInteraction): Promise<void>;
}

export interface SelectMenuHandler {
  execute(interaction: StringSelectMenuInteraction): Promise<void>;
}

export interface ModalHandler {
  execute(interaction: ModalSubmitInteraction): Promise<void>;
}

/**
 * Processes slash commands and button interactions
 * Provides centralized routing for all Discord interactions
 */
export class InteractionHandler {
  private commandHandlers: Map<string, CommandHandler> = new Map();
  private buttonHandlers: Map<string, ButtonHandler> = new Map();
  private selectMenuHandlers: Map<string, SelectMenuHandler> = new Map();
  private modalHandlers: Map<string, ModalHandler> = new Map();
  private logger: Logger;

  constructor() {
    this.logger = new Logger('InteractionHandler');
  }

  /**
   * Register a command handler
   */
  registerCommandHandler(commandName: string, handler: CommandHandler): void {
    this.commandHandlers.set(commandName, handler);
    this.logger.info(`Registered command handler: ${commandName}`);
  }

  /**
   * Register a button interaction handler
   */
  registerButtonHandler(customId: string, handler: ButtonHandler): void {
    this.buttonHandlers.set(customId, handler);
    this.logger.info(`Registered button handler: ${customId}`);
  }

  /**
   * Register a select menu handler
   */
  registerSelectMenuHandler(customId: string, handler: SelectMenuHandler): void {
    this.selectMenuHandlers.set(customId, handler);
    this.logger.info(`Registered select menu handler: ${customId}`);
  }

  /**
   * Register a modal handler
   */
  registerModalHandler(customId: string, handler: ModalHandler): void {
    this.modalHandlers.set(customId, handler);
    this.logger.info(`Registered modal handler: ${customId}`);
  }

  /**
   * Process any Discord interaction
   */
  async handleInteraction(interaction: Interaction): Promise<void> {
    try {
      switch (interaction.type) {
        case InteractionType.ApplicationCommand:
          if (interaction.isChatInputCommand()) {
            await this.handleChatInputCommand(interaction);
          }
          break;

        case InteractionType.MessageComponent:
          if (interaction.isButton()) {
            await this.handleButton(interaction);
          } else if (interaction.isStringSelectMenu()) {
            await this.handleSelectMenu(interaction);
          }
          break;

        case InteractionType.ModalSubmit:
          await this.handleModal(interaction);
          break;

        default:
          this.logger.warn(`Unhandled interaction type: ${interaction.type}`);
      }
    } catch (error) {
      this.logger.error('Error handling interaction:', error);
      await this.sendErrorResponse(interaction, 'An error occurred while processing your request.');
    }
  }

  /**
   * Handle chat input (slash) commands
   */
  private async handleChatInputCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const handler = this.commandHandlers.get(interaction.commandName);
    
    if (!handler) {
      this.logger.warn(`No handler found for command: ${interaction.commandName}`);
      await interaction.reply({ 
        content: 'This command is not available.', 
        ephemeral: true 
      });
      return;
    }

    this.logger.info(`Executing command: ${interaction.commandName} by ${interaction.user.tag}`);
    await handler.execute(interaction);
  }

  /**
   * Handle button interactions
   */
  private async handleButton(interaction: ButtonInteraction): Promise<void> {
    const customId = this.extractCustomId(interaction.customId);
    const handler = this.buttonHandlers.get(customId);
    
    if (!handler) {
      this.logger.warn(`No handler found for button: ${customId}`);
      await interaction.reply({ 
        content: 'This button is no longer available.', 
        ephemeral: true 
      });
      return;
    }

    this.logger.info(`Executing button: ${customId} by ${interaction.user.tag}`);
    await handler.execute(interaction);
  }

  /**
   * Handle select menu interactions
   */
  private async handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
    const customId = this.extractCustomId(interaction.customId);
    const handler = this.selectMenuHandlers.get(customId);
    
    if (!handler) {
      this.logger.warn(`No handler found for select menu: ${customId}`);
      await interaction.reply({ 
        content: 'This menu is no longer available.', 
        ephemeral: true 
      });
      return;
    }

    this.logger.info(`Executing select menu: ${customId} by ${interaction.user.tag}`);
    await handler.execute(interaction);
  }

  /**
   * Handle modal submissions
   */
  private async handleModal(interaction: ModalSubmitInteraction): Promise<void> {
    const customId = this.extractCustomId(interaction.customId);
    const handler = this.modalHandlers.get(customId);
    
    if (!handler) {
      this.logger.warn(`No handler found for modal: ${customId}`);
      await interaction.reply({ 
        content: 'This form is no longer available.', 
        ephemeral: true 
      });
      return;
    }

    this.logger.info(`Executing modal: ${customId} by ${interaction.user.tag}`);
    await handler.execute(interaction);
  }

  /**
   * Extract the base custom ID (removes any parameters after ':')
   */
  private extractCustomId(fullCustomId: string): string {
    return fullCustomId.split(':')[0] || fullCustomId;
  }

  /**
   * Send an error response to the user
   */
  private async sendErrorResponse(interaction: Interaction, message: string): Promise<void> {
    try {
      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: message, ephemeral: true });
        } else {
          await interaction.reply({ content: message, ephemeral: true });
        }
      }
    } catch (error) {
      this.logger.error('Failed to send error response:', error);
    }
  }

  /**
   * Get all registered command names
   */
  getRegisteredCommands(): string[] {
    return Array.from(this.commandHandlers.keys());
  }

  /**
   * Get all registered button handler IDs
   */
  getRegisteredButtons(): string[] {
    return Array.from(this.buttonHandlers.keys());
  }

  /**
   * Clear all registered handlers
   */
  clearHandlers(): void {
    this.commandHandlers.clear();
    this.buttonHandlers.clear();
    this.selectMenuHandlers.clear();
    this.modalHandlers.clear();
    this.logger.info('Cleared all interaction handlers');
  }
}