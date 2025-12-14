import { Client, GatewayIntentBits, Events, REST, Routes, SlashCommandBuilder, Interaction, ClientOptions } from 'discord.js';
import { Logger } from '../utils/Logger';

export interface BotCommand {
  data: SlashCommandBuilder;
  execute: (interaction: Interaction) => Promise<void>;
}

export interface DiscordClientConfig {
  token: string;
  clientId: string;
  guildId?: string;
  intents?: GatewayIntentBits[];
}

/**
 * Discord client wrapper for bot connection management
 * Handles bot initialization, command registration, and event management
 */
export class DiscordClient {
  private client: Client;
  private config: DiscordClientConfig;
  private commands: Map<string, BotCommand> = new Map();
  private logger: Logger;
  private isReady: boolean = false;

  constructor(config: DiscordClientConfig) {
    this.config = config;
    this.logger = new Logger('DiscordClient');
    
    const clientOptions: ClientOptions = {
      intents: config.intents || [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    };

    this.client = new Client(clientOptions);
    this.setupEventHandlers();
  }

  /**
   * Initialize the Discord client and connect to Discord
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Discord client...');
      await this.client.login(this.config.token);
      
      // Wait for client to be ready
      if (!this.isReady) {
        await new Promise<void>((resolve) => {
          this.client.once(Events.ClientReady, () => {
            resolve();
          });
        });
      }
      
      this.logger.info('Discord client initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Discord client:', error);
      throw error;
    }
  }

  /**
   * Register a command with the Discord client
   */
  registerCommand(command: BotCommand): void {
    this.commands.set(command.data.name, command);
    this.logger.info(`Registered command: ${command.data.name}`);
  }

  /**
   * Deploy all registered commands to Discord
   */
  async deployCommands(): Promise<void> {
    try {
      this.logger.info('Deploying commands to Discord...');
      
      const rest = new REST().setToken(this.config.token);
      const commandData = Array.from(this.commands.values()).map(cmd => cmd.data.toJSON());

      if (this.config.guildId) {
        // Deploy to specific guild (faster for development)
        await rest.put(
          Routes.applicationGuildCommands(this.config.clientId, this.config.guildId),
          { body: commandData }
        );
        this.logger.info(`Deployed ${commandData.length} commands to guild ${this.config.guildId}`);
      } else {
        // Deploy globally (takes up to 1 hour to propagate)
        await rest.put(
          Routes.applicationCommands(this.config.clientId),
          { body: commandData }
        );
        this.logger.info(`Deployed ${commandData.length} commands globally`);
      }
    } catch (error) {
      this.logger.error('Failed to deploy commands:', error);
      throw error;
    }
  }

  /**
   * Get the underlying Discord.js client
   */
  getClient(): Client {
    return this.client;
  }

  /**
   * Check if the client is ready and connected
   */
  isClientReady(): boolean {
    return this.isReady && this.client.isReady();
  }

  /**
   * Gracefully shutdown the Discord client
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down Discord client...');
    this.client.destroy();
    this.isReady = false;
  }

  /**
   * Set up event handlers for the Discord client
   */
  private setupEventHandlers(): void {
    this.client.once(Events.ClientReady, (readyClient) => {
      this.isReady = true;
      this.logger.info(`Discord client ready! Logged in as ${readyClient.user.tag}`);
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const command = this.commands.get(interaction.commandName);
      if (!command) {
        this.logger.warn(`Unknown command: ${interaction.commandName}`);
        return;
      }

      try {
        await command.execute(interaction);
      } catch (error) {
        this.logger.error(`Error executing command ${interaction.commandName}:`, error);
        
        const errorMessage = 'There was an error while executing this command!';
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
          await interaction.reply({ content: errorMessage, ephemeral: true });
        }
      }
    });

    this.client.on(Events.Error, (error) => {
      this.logger.error('Discord client error:', error);
    });

    this.client.on(Events.Warn, (warning) => {
      this.logger.warn('Discord client warning:', warning);
    });
  }
}