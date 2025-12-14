import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { BaseCommandRegistry } from './BaseCommandRegistry';
import { BaseEventHandlers } from './BaseEventHandlers';
import { Logger } from '../../core/utils/Logger';
import { DatabaseConnectionFactory, DatabaseConfig } from '../../core/storage/DatabaseConnection';

export interface BotConfig {
  botName: string;
  gameType: 'semantle' | 'travle' | 'duotrigordle';
  token: string;
  clientId: string;
}

export abstract class BaseBotApplication {
  protected client: Client;
  protected commandRegistry: BaseCommandRegistry;
  protected eventHandlers: BaseEventHandlers;
  protected logger: Logger;
  protected config: BotConfig;

  constructor(config: BotConfig) {
    this.config = config;
    this.logger = new Logger(config.botName);
    
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
      ]
    });

    this.commandRegistry = new BaseCommandRegistry(this.logger);
    this.eventHandlers = new BaseEventHandlers(this.client, this.commandRegistry, this.logger);
  }

  public async start(): Promise<void> {
    try {
      // Initialize database connection
      await this.initializeDatabase();

      // Register commands
      this.registerCommands();

      // Set up event handlers
      this.eventHandlers.initialize();

      // Login to Discord
      await this.client.login(this.config.token);
      
      this.logger.info(`${this.config.botName} bot started successfully`);
    } catch (error) {
      this.logger.error(`Failed to start ${this.config.botName} bot:`, error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    try {
      await this.client.destroy();
      await DatabaseConnectionFactory.close();
      this.logger.info(`${this.config.botName} bot stopped`);
    } catch (error) {
      this.logger.error(`Error stopping ${this.config.botName} bot:`, error);
      throw error;
    }
  }

  protected abstract registerCommands(): void;

  private async initializeDatabase(): Promise<void> {
    const dbConfig: DatabaseConfig = {
      type: process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite',
      database: process.env.DATABASE_URL || `${this.config.gameType}-bot.db`,
      ...(process.env.DB_HOST && { host: process.env.DB_HOST }),
      ...(process.env.DB_PORT && { port: parseInt(process.env.DB_PORT) }),
      ...(process.env.DB_USER && { username: process.env.DB_USER }),
      ...(process.env.DB_PASSWORD && { password: process.env.DB_PASSWORD }),
    };

    await DatabaseConnectionFactory.create(dbConfig);
    this.logger.info('Database connection initialized');
  }

  public async deployCommands(): Promise<void> {
    try {
      const rest = new REST({ version: '10' }).setToken(this.config.token);
      const commands = this.commandRegistry.getCommandsForDeployment();

      this.logger.info(`Deploying ${commands.length} commands for ${this.config.botName}...`);

      await rest.put(
        Routes.applicationCommands(this.config.clientId),
        { body: commands }
      );

      this.logger.info(`Successfully deployed commands for ${this.config.botName}`);
    } catch (error) {
      this.logger.error(`Failed to deploy commands for ${this.config.botName}:`, error);
      throw error;
    }
  }
}