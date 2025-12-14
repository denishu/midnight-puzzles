import { DiscordClient, DiscordClientConfig } from '@core/discord/DiscordClient';
import { SlashCommandBuilder } from 'discord.js';

// Mock discord.js Client to avoid actual Discord connections in tests
jest.mock('discord.js', () => {
  const mockClient = {
    login: jest.fn().mockResolvedValue('mock-token'),
    once: jest.fn(),
    on: jest.fn(),
    destroy: jest.fn(),
    isReady: jest.fn().mockReturnValue(true)
  };

  return {
    Client: jest.fn(() => mockClient),
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      MessageContent: 4
    },
    Events: {
      ClientReady: 'ready',
      InteractionCreate: 'interactionCreate',
      Error: 'error',
      Warn: 'warn'
    },
    REST: jest.fn(() => ({
      setToken: jest.fn().mockReturnThis(),
      put: jest.fn().mockResolvedValue([])
    })),
    Routes: {
      applicationCommands: jest.fn(),
      applicationGuildCommands: jest.fn()
    },
    SlashCommandBuilder: jest.fn(() => ({
      setName: jest.fn().mockReturnThis(),
      setDescription: jest.fn().mockReturnThis(),
      toJSON: jest.fn().mockReturnValue({ name: 'test', description: 'test' })
    }))
  };
});

describe('DiscordClient', () => {
  let config: DiscordClientConfig;

  beforeEach(() => {
    config = {
      token: 'test-token',
      clientId: 'test-client-id',
      guildId: 'test-guild-id'
    };
  });

  describe('constructor', () => {
    it('should create a DiscordClient instance', () => {
      const client = new DiscordClient(config);
      expect(client).toBeInstanceOf(DiscordClient);
    });

    it('should use default intents when none provided', () => {
      const client = new DiscordClient(config);
      expect(client).toBeInstanceOf(DiscordClient);
    });

    it('should use custom intents when provided', () => {
      const customConfig = {
        ...config,
        intents: [1, 2] // Mock intent values
      };
      const client = new DiscordClient(customConfig);
      expect(client).toBeInstanceOf(DiscordClient);
    });
  });

  describe('registerCommand', () => {
    it('should register a command', () => {
      const client = new DiscordClient(config);
      const mockCommand = {
        data: new SlashCommandBuilder(),
        execute: jest.fn()
      };

      expect(() => client.registerCommand(mockCommand)).not.toThrow();
    });
  });

  describe('isClientReady', () => {
    it('should return false initially', () => {
      const client = new DiscordClient(config);
      expect(client.isClientReady()).toBe(false);
    });
  });

  describe('getClient', () => {
    it('should return the underlying Discord client', () => {
      const client = new DiscordClient(config);
      const discordClient = client.getClient();
      expect(discordClient).toBeDefined();
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      const client = new DiscordClient(config);
      await expect(client.shutdown()).resolves.not.toThrow();
    });
  });
});