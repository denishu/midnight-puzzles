import { EmbedBuilder } from '../../core/discord/EmbedBuilder';
import { StreakRepository, isSyntheticServer } from '../../core/storage/StreakRepository';
import { Logger } from '../../core/utils/Logger';

/**
 * Pretty game titles for the embed header.
 */
const GAME_LABEL: Record<string, string> = {
  semantle: 'Semantle',
  travle: 'Travle',
  duotrigordle: 'Duotrigordle',
  betweenle: 'Betweenle',
};

function pluralDays(n: number): string {
  return `${n} day${n === 1 ? '' : 's'}`;
}

/**
 * Shared handler for the `/streak` slash command, registered by all three bots.
 *
 * Shows three per-server numbers in one embed:
 *   1. The caller's CURRENT (active) streak in this server.
 *   2. The caller's PERSONAL BEST streak in this server.
 *   3. The SERVER's all-time longest streak (any member).
 *
 * Streaks are per (user, server, game): a day with no completion in THIS server
 * breaks the streak here even if the user played the same game elsewhere. All
 * values are read from persisted counters (StreakRepository), so they remain
 * correct beyond the 7-day session-retention window.
 *
 * Outside a real guild (DM / Activity context, where guildId is null or
 * synthetic) there is no server to scope to, so the command explains that and
 * shows nothing misleading.
 */
export function makeStreakHandler(gameType: string, streakRepo: StreakRepository, logger: Logger) {
  const label = GAME_LABEL[gameType] ?? gameType;

  return async function handleStreak(interaction: any): Promise<void> {
    try {
      await interaction.deferReply({ ephemeral: true });

      const userId: string = interaction.user.id;
      const username: string = interaction.user.username;
      const serverId: string | null = interaction.guildId;

      // No real server to scope per-server streaks to.
      if (!serverId || isSyntheticServer(serverId)) {
        const embed = EmbedBuilder.createGameEmbed(
          gameType,
          `🔥 ${label} Streaks`,
          'Streaks are tracked per server. Run `/streak` inside a server (not a DM) to see your streak and the server record.',
        );
        await interaction.editReply({ embeds: [embed] });
        return;
      }

      const [player, server] = await Promise.all([
        streakRepo.getPlayerStreak(userId, serverId, gameType),
        streakRepo.getServerStreak(serverId, gameType),
      ]);

      const playerCurrent = player?.currentCount ?? 0;
      const playerBest = player?.maxCount ?? 0;
      const serverBest = server?.maxCount ?? 0;

      const embed = EmbedBuilder.createGameEmbed(gameType, `🔥 ${label} Streaks`);
      embed.setDescription(`Streaks for **${username}** in this server.`);
      embed.addFields(
        { name: '🔥 Your current streak', value: pluralDays(playerCurrent), inline: true },
        { name: '🏅 Your best streak', value: pluralDays(playerBest), inline: true },
        { name: '🏆 Server record', value: pluralDays(serverBest), inline: true },
      );

      // A little context line to make a zero-state feel intentional, not broken.
      if (playerCurrent === 0 && playerBest === 0 && serverBest === 0) {
        embed.setFooter({ text: `Play ${label} daily to start a streak! Streaks update after midnight UTC.` });
      } else if (playerCurrent === 0) {
        embed.setFooter({ text: 'Your active streak is 0 -- complete today\'s puzzle to start a new one!' });
      } else if (playerBest > 0 && playerCurrent === playerBest) {
        embed.setFooter({ text: 'You\'re on your best streak ever -- keep it going!' });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      logger.error(`Error in /streak (${gameType}):`, error);
      const errEmbed = EmbedBuilder.createError('Streak unavailable', 'Could not retrieve streak data. Please try again.');
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errEmbed] });
      } else {
        await interaction.reply({ embeds: [errEmbed], ephemeral: true });
      }
    }
  };
}
