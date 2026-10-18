import { GameStateRepository } from '../../core/storage/GameStateRepository';
import { StreakRepository, isSyntheticServer, isSyntheticUser } from '../../core/storage/StreakRepository';
import { isSessionComplete } from '../../core/storage/completion';
import { Logger } from '../../core/utils/Logger';

/** Minimal guild shape we need (matches discord.js Guild). */
export interface GuildLike {
  id: string;
  name: string;
  icon: string | null;
}

/**
 * Advance persisted streaks for a game, gap-tolerantly, from the completed
 * sessions still in the retention window, then reset any scope that lapsed on
 * the just-finished day. MUST be called BEFORE deleteOldSessions(7) in the
 * nightly job, while the window of completions is still present.
 *
 * Scopes updated:
 *   - player: (server_id, user_id, game_type) -- a user's streak IN a server.
 *   - server: (server_id, game_type)          -- the server's daily-win streak.
 *
 * Synthetic servers (activity/dm) and synthetic users (local_ prefix, default)
 * are excluded -- they aren't real guilds/accounts and shouldn't appear.
 *
 * Gap tolerance: StreakRepository.advance() ignores days already counted (by
 * current_last_date) and restarts on a gap, so running this after a short bot
 * outage replays the missed-but-still-retained days correctly and is a no-op if
 * nothing new happened.
 *
 * @param windowDays how many days of completions to consider (match the purge
 *   window, default 7). The "just-finished day" for lapse detection is derived
 *   from the newest puzzle_date observed, falling back to yesterday.
 */
export async function updateStreaks(
  gameType: string,
  sessionRepo: GameStateRepository,
  streakRepo: StreakRepository,
  guilds: Iterable<GuildLike>,
  logger: Logger,
  windowDays = 7,
): Promise<void> {
  try {
    const sessions = await sessionRepo.getCompletedSessionsInWindow(gameType, windowDays);

    // Build completed-date sets per scope, applying the shared predicate and
    // excluding synthetic servers/users.
    const playerDates = new Map<string, Set<string>>(); // key: server_id\x00user_id
    const serverDates = new Map<string, Set<string>>(); // key: server_id
    const playerKeys = new Map<string, { serverId: string; userId: string }>();

    for (const s of sessions) {
      if (!isSessionComplete(s)) continue;
      if (isSyntheticServer(s.serverId)) continue;
      const date = s.puzzleDate.toISOString().split('T')[0]!;

      // Server scope counts any real user's completion (incl. real users only).
      if (!isSyntheticUser(s.userId)) {
        const sKey = s.serverId;
        (serverDates.get(sKey) ?? serverDates.set(sKey, new Set()).get(sKey)!).add(date);

        const pKey = `${s.serverId}\x00${s.userId}`;
        (playerDates.get(pKey) ?? playerDates.set(pKey, new Set()).get(pKey)!).add(date);
        if (!playerKeys.has(pKey)) playerKeys.set(pKey, { serverId: s.serverId, userId: s.userId });
      }
    }

    // The day whose completion we check for lapse: the most recent puzzle_date
    // seen, else yesterday. (All scopes share the same daily cadence.)
    const allDates = sessions.map(s => s.puzzleDate.toISOString().split('T')[0]!).sort();
    const latestDate = allDates.length ? allDates[allDates.length - 1]! : (() => {
      const y = new Date(); y.setUTCDate(y.getUTCDate() - 1); return y.toISOString().split('T')[0]!;
    })();

    // Advance server scopes.
    for (const [serverId, dates] of serverDates) {
      await streakRepo.advance('server', serverId, gameType, [...dates]);
    }
    // Advance player scopes.
    for (const [pKey, dates] of playerDates) {
      const { serverId, userId } = playerKeys.get(pKey)!;
      await streakRepo.advance('player', serverId, gameType, [...dates], userId);
    }

    // Lapse handling: zero every active streak for this game whose last counted
    // day is older than latestDate. One set-based UPDATE covers both scopes AND
    // scopes that stopped playing entirely (which wouldn't appear above).
    await streakRepo.resetAllLapsed(gameType, latestDate);

    // Capture guild display metadata for the public leaderboard.
    for (const guild of guilds) {
      if (isSyntheticServer(guild.id)) continue;
      await streakRepo.upsertServerMeta(guild.id, gameType, guild.name, guild.icon);
    }

    logger.info(`[streaks] updated ${serverDates.size} server(s), ${playerDates.size} player-scope(s) for ${gameType}`);
  } catch (e) {
    // Never let streak bookkeeping break the daily post.
    logger.error('[streaks] update failed', { gameType, error: e });
  }
}
