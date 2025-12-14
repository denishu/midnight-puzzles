import { Client, Events, ChatInputCommandInteraction } from 'discord.js';
import { BaseCommandRegistry } from './BaseCommandRegistry';
import { Logger } from '../../core/utils/Logger';

export class BaseEventHandlers {
  private client: Client;
  private commandRegistry: BaseCommandRegistry;
  private logger: Logger;

  constructor(client: Client, commandRegistry: BaseCommandRegistry, logger: Logger) {
    this.client = client;
    this.commandRegistry = commandRegistry;
    this.logger = logger;
  }

  public initialize(): void {
    this.client.once(Events.ClientReady, this.onReady.bind(this));
    this.client.on(Events.InteractionCreate, this.onInteractionCreate.bind(this));
    this.client.on(Events.Error, this.onError.bind(this));
    this.client.on(Events.Warn, this.onWarn.bind(this));
  }

  private onReady(client: Client<true>): void {
    this.logger.info(`Bot logged in as ${client.user.tag}!`);
    this.logger.info(`Bot is in ${client.guilds.cache.size} servers`);
    
    // Set bot activity status
    client.user.setActivity('daily puzzles', { type: 0 }); // Type 0 = Playing
  }

  private async onInteractionCreate(interaction: any): Promise<void> {
    if (!interaction.isChatInputCommand()) return;

    this.logger.info(`Command received: ${interaction.commandName} from ${interaction.user.tag} in ${interaction.guild?.name || 'DM'}`);

    try {
      await this.commandRegistry.handleCommand(interaction as ChatInputCommandInteraction);
    } catch (error) {
      this.logger.error('Error handling interaction:', error);
    }
  }

  private onError(error: Error): void {
    this.logger.error('Discord client error:', error);
  }

  private onWarn(warning: string): void {
    this.logger.warn('Discord client warning:', warning);
  }
}