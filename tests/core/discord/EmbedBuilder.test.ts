import { EmbedBuilder } from '@core/discord/EmbedBuilder';
import { EmbedBuilder as DiscordEmbedBuilder } from 'discord.js';

describe('EmbedBuilder', () => {
  describe('createGameEmbed', () => {
    it('should create a basic game embed with correct color', () => {
      const embed = EmbedBuilder.createGameEmbed('semantle', 'Test Title', 'Test Description');
      
      expect(embed).toBeInstanceOf(DiscordEmbedBuilder);
      expect(embed.data.title).toBe('Test Title');
      expect(embed.data.description).toBe('Test Description');
      expect(embed.data.color).toBe(0x9932cc); // Semantle color
    });

    it('should use default color for unknown game types', () => {
      const embed = EmbedBuilder.createGameEmbed('unknown', 'Test Title');
      
      expect(embed.data.color).toBe(0x0099ff); // Default color
    });
  });

  describe('createSemantle', () => {
    it('should create a Semantle embed for incomplete game', () => {
      const guesses = [
        { word: 'test', rank: 100, similarity: 0.5 },
        { word: 'word', similarity: 0.2 }
      ];
      
      const embed = EmbedBuilder.createSemantle(null, guesses, false);
      
      expect(embed.data.title).toContain('Semantle');
      expect(embed.data.description).toContain('semantic similarity');
      expect(embed.data.fields).toHaveLength(1);
      expect(embed.data.fields?.[0]?.name).toContain('Recent Guesses');
    });

    it('should create a Semantle embed for completed game', () => {
      const embed = EmbedBuilder.createSemantle('TARGET', [], true);
      
      expect(embed.data.description).toContain('Congratulations');
      expect(embed.data.description).toContain('TARGET');
      expect(embed.data.color).toBe(0x00ff00); // Success color
    });
  });

  describe('createTravle', () => {
    it('should create a Travle embed for active game', () => {
      const embed = EmbedBuilder.createTravle(
        'France',
        'Germany',
        ['France', 'Belgium'],
        3,
        false
      );
      
      expect(embed.data.title).toContain('Travle');
      expect(embed.data.description).toContain('France');
      expect(embed.data.description).toContain('Germany');
      expect(embed.data.fields).toHaveLength(2); // Current Path and Remaining Attempts
    });

    it('should create a Travle embed for completed game', () => {
      const embed = EmbedBuilder.createTravle(
        'France',
        'Germany',
        ['France', 'Belgium', 'Germany'],
        0,
        true
      );
      
      expect(embed.data.description).toContain('Success');
      expect(embed.data.color).toBe(0x00ff00); // Success color
    });
  });

  describe('createDuotrigordle', () => {
    it('should create a Duotrigordle embed with progress', () => {
      const grids = Array(32).fill(null).map((_, i) => ({
        cells: [],
        isComplete: i < 10 // 10 completed grids
      }));
      
      const embed = EmbedBuilder.createDuotrigordle(grids, 10, 32, 25);
      
      expect(embed.data.title).toContain('Duotrigordle');
      expect(embed.data.description).toContain('10/32');
      expect(embed.data.description).toContain('31.3%');
      expect(embed.data.fields).toHaveLength(2); // Grid Status and Remaining Attempts
    });

    it('should create a Duotrigordle embed for completed game', () => {
      const grids = Array(32).fill(null).map(() => ({
        cells: [],
        isComplete: true
      }));
      
      const embed = EmbedBuilder.createDuotrigordle(grids, 32, 32, 0);
      
      expect(embed.data.description).toContain('Congratulations');
      expect(embed.data.color).toBe(0x00ff00); // Success color
    });
  });

  describe('createWordleGrid', () => {
    it('should create a visual grid representation', () => {
      const grid = {
        cells: [
          [
            { value: 'T', status: 'correct' as const },
            { value: 'E', status: 'present' as const },
            { value: 'S', status: 'absent' as const },
            { value: 'T', status: 'empty' as const },
            { value: 'S', status: 'empty' as const }
          ]
        ]
      };
      
      const result = EmbedBuilder.createWordleGrid(grid);
      
      expect(result).toBe('🟩🟨⬛⬜⬜');
    });
  });

  describe('createProgressBar', () => {
    it('should create a progress bar with percentage', () => {
      const progress = { current: 7, total: 10 };
      const result = EmbedBuilder.createProgressBar(progress, 10);
      
      expect(result).toContain('█'.repeat(7));
      expect(result).toContain('░'.repeat(3));
      expect(result).toContain('70.0%');
    });

    it('should use provided percentage', () => {
      const progress = { current: 5, total: 10, percentage: 0.8 };
      const result = EmbedBuilder.createProgressBar(progress, 10);
      
      expect(result).toContain('█'.repeat(8));
      expect(result).toContain('80.0%');
    });
  });

  describe('createStatsEmbed', () => {
    it('should create a statistics embed', () => {
      const stats = {
        'Games Played': 15,
        'Win Rate': '80%',
        'Average Attempts': 6.2
      };
      
      const embed = EmbedBuilder.createStatsEmbed('semantle', stats);
      
      expect(embed.data.title).toContain('Statistics');
      expect(embed.data.fields).toHaveLength(3);
    });
  });

  describe('createLeaderboard', () => {
    it('should create a leaderboard embed with entries', () => {
      const entries = [
        { rank: 1, name: 'Player1', score: '5 attempts' },
        { rank: 2, name: 'Player2', score: '7 attempts' },
        { rank: 3, name: 'Player3', score: '9 attempts' }
      ];
      
      const embed = EmbedBuilder.createLeaderboard('semantle', entries);
      
      expect(embed.data.title).toContain('Leaderboard');
      expect(embed.data.description).toContain('🥇');
      expect(embed.data.description).toContain('🥈');
      expect(embed.data.description).toContain('🥉');
    });

    it('should handle empty leaderboard', () => {
      const embed = EmbedBuilder.createLeaderboard('semantle', []);
      
      expect(embed.data.description).toContain('No entries yet');
    });
  });

  describe('createError', () => {
    it('should create an error embed', () => {
      const embed = EmbedBuilder.createError('Test Error', 'Error message');
      
      expect(embed.data.title).toContain('Test Error');
      expect(embed.data.description).toBe('Error message');
      expect(embed.data.color).toBe(0xff0000); // Error color
    });
  });

  describe('createHelp', () => {
    it('should create a help embed with examples', () => {
      const examples = ['Example 1', 'Example 2'];
      const embed = EmbedBuilder.createHelp('semantle', 'Instructions', examples);
      
      expect(embed.data.title).toContain('How to Play Semantle');
      expect(embed.data.description).toBe('Instructions');
      expect(embed.data.fields).toHaveLength(1);
      expect(embed.data.fields?.[0]?.name).toBe('Examples');
    });

    it('should create a help embed without examples', () => {
      const embed = EmbedBuilder.createHelp('travle', 'Instructions');
      
      expect(embed.data.title).toContain('How to Play Travle');
      expect(embed.data.fields).toBeUndefined();
    });
  });
});