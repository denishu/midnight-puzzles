import { MessageFormatter, GameResult } from '@core/discord/MessageFormatter';
import { EmbedBuilder as DiscordEmbedBuilder } from 'discord.js';

describe('MessageFormatter', () => {
  describe('formatGameStart', () => {
    it('should create a game start message with proper formatting', () => {
      const result = MessageFormatter.formatGameStart(
        'Semantle',
        'Test game description',
        'Test instructions'
      );

      expect(result.embeds).toHaveLength(1);
      expect(result.embeds?.[0]).toBeInstanceOf(DiscordEmbedBuilder);
      
      const embed = result.embeds?.[0];
      expect(embed?.data.title).toContain('Semantle');
      expect(embed?.data.description).toBe('Test game description');
      expect(embed?.data.fields).toHaveLength(1);
      expect(embed?.data.fields?.[0]?.name).toBe('How to Play');
    });

    it('should create a game start message without instructions', () => {
      const result = MessageFormatter.formatGameStart(
        'Travle',
        'Test description'
      );

      expect(result.embeds).toHaveLength(1);
      const embed = result.embeds?.[0];
      expect(embed?.data.title).toContain('Travle');
      expect(embed?.data.fields).toBeUndefined();
    });
  });

  describe('formatGameComplete', () => {
    it('should format a successful game completion', () => {
      const gameResult: GameResult = {
        gameType: 'Semantle',
        isComplete: true,
        attempts: 5,
        maxAttempts: 10,
        timeTaken: 120000, // 2 minutes
        score: 85
      };

      const result = MessageFormatter.formatGameComplete(gameResult);

      expect(result.embeds).toHaveLength(1);
      const embed = result.embeds?.[0];
      expect(embed?.data.title).toContain('Puzzle Completed!');
      expect(embed?.data.fields).toHaveLength(4); // Status, Attempts, Time, Score
    });

    it('should format a failed game completion', () => {
      const gameResult: GameResult = {
        gameType: 'Duotrigordle',
        isComplete: false,
        attempts: 37,
        maxAttempts: 37
      };

      const result = MessageFormatter.formatGameComplete(gameResult);

      expect(result.embeds).toHaveLength(1);
      const embed = result.embeds?.[0];
      expect(embed?.data.title).toContain('Game Over');
      expect(embed?.data.fields).toHaveLength(2); // Status, Attempts
    });
  });

  describe('formatError', () => {
    it('should create an error message with ephemeral flag', () => {
      const result = MessageFormatter.formatError('Test Error', 'Error message');

      expect(result.embeds).toHaveLength(1);
      expect(result.ephemeral).toBe(true);
      
      const embed = result.embeds?.[0];
      expect(embed?.data.title).toContain('Test Error');
      expect(embed?.data.description).toBe('Error message');
    });
  });

  describe('formatSpoiler', () => {
    it('should wrap text in spoiler tags', () => {
      const result = MessageFormatter.formatSpoiler('secret text');
      expect(result).toBe('||secret text||');
    });
  });

  describe('formatCodeBlock', () => {
    it('should create a code block with language', () => {
      const result = MessageFormatter.formatCodeBlock('console.log("test")', 'javascript');
      expect(result).toBe('```javascript\nconsole.log("test")\n```');
    });

    it('should create a code block without language', () => {
      const result = MessageFormatter.formatCodeBlock('plain text');
      expect(result).toBe('```\nplain text\n```');
    });
  });

  describe('toInteractionReply', () => {
    it('should convert FormattedMessage to InteractionReplyOptions', () => {
      const message = MessageFormatter.formatInfo('Test', 'Test message', true);
      const reply = MessageFormatter.toInteractionReply(message);

      expect(reply.ephemeral).toBe(true);
      expect(reply.embeds).toBeDefined();
    });
  });
});