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
 * Resolves a guild's display metadata by id, authoritatively.
 *
 * Returns the guild's {@link GuildLike} shape, or null if it cannot be resolved
 * (e.g. the bot was removed from that server, or Discord returns Unknown Guild).
 * Implementations should PREFER the in-memory gateway cache and fall back to a
 * REST fetch on a miss, so that servers absent from the cache at nightly-run
 * time (just-restarted bot, partially-hydrated cache) still get named.
 */
export interface GuildResolver {
  resolve(id: string): Promise<GuildLike | null>;
}

/**
 * Build a {@link GuildResolver} from a discord.js client.
 *
 * `client.guilds.fetch(id)` checks the cache first and performs a REST lookup on
 * a miss, which is exactly the behavior we want: cheap for cached guilds, and
 * authoritative for ones the gateway hasn't streamed to us yet. A failed fetch
 * (bot no longer in the guild -> Unknown Guild / Missing Access) resolves to
 * null and is skipped by the caller rather than throwing.
 *
 * Accepts a structurally-typed client so this module doesn't hard-depend on
 * discord.js types (and stays trivially testable).
 */
export function clientGuildResolver(
  client: { guilds: { fetch(id: string): Promise<{ id: string; name: string; icon: string | null }> } },
  logger?: Logger,
): GuildResolver {
  return {
    async resolve(id: string): Promise<GuildLike | null> {
      try {
        const g = await client.guilds.fetch(id);
        return { id: g.id, name: g.name, icon: g.icon };
      } catch (e) {
        // Most commonly: the bot was removed from this guild, so it can no
        // longer be fetched. That's expected for ghost rows -- skip, don't throw.
        logger?.debug?.(`[streaks] could not resolve guild ${id} (likely bot removed)`, { error: e });
        return null;
      }
    },
  };
}

/**
 * Adapt a fixed collection of guilds (e.g. the gateway cache snapshot, or a
 * test fixture) into a {@link GuildResolver}. Useful where a REST client isn't
 * available; resolves only from the provided set and returns null for misses.
 */
export function iterableGuildResolver(guilds: Iterable<GuildLike>): GuildResolver {
  const byId = new Map<string, GuildLike>();
  for (const g of guilds) byId.set(g.id, g);
  return {
    async resolve(id: string): Promise<GuildLike | null> {
      return byId.get(id) ?? null;
    },
  };
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
 * Metadata (guild name + icon) is resolved for EVERY server that has a streak
 * this run -- not just the ones currently in the gateway cache. The two writers
 * (advance = counts, upsertServerMeta = name/icon) target the same row and each
 * only touches its own columns, so they must cover the SAME set of servers for
 * a row to end up complete. Resolving by streak-server (via `guildResolver`,
 * which falls back to a REST fetch) guarantees that and also self-heals rows
 * previously left name-less because their server wasn't cached at run time.
 *
 * Membership gating: a streak (either scope) is advanced ONLY for servers the
 * bot is actually a member of. A streak is only ever surfaced to users through
 * embed messages -- the daily recap's "Server streak" line and the /streak
 * command -- both of which require the bot to be in the guild. Sessions can be
 * created in guilds WITHOUT the bot via user-installed Activity launches; those
 * guilds get no embed, no /streak, and no daily prompt, so tracking a streak
 * for them (and leaking it onto the public leaderboard) is incoherent. We use
 * the resolver as the membership test: resolve() returns null exactly when the
 * bot cannot fetch the guild (Unknown Guild / Missing Access = not a member).
 *
 * @param guilds either a {@link GuildResolver} (preferred; enables REST
 *   fallback) or a plain iterable of guilds (wrapped into a resolver). Passing
 *   an iterable means misses cannot be back-filled -- use a resolver in prod.
 * @param windowDays how many days of completions to consider (match the purge
 *   window, default 7). The "just-finished day" for lapse detection is derived
 *   from the newest puzzle_date observed, falling back to yesterday.
 */
export async function updateStreaks(
  gameType: string,
  sessionRepo: GameStateRepository,
  streakRepo: StreakRepository,
  guilds: GuildResolver | Iterable<GuildLike>,
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

    // Membership gate: resolve every candidate server ONCE. A server resolves
    // iff the bot is a member of it (resolver.resolve returns the guild);
    // otherwise it's a user-install/bot-less guild and we skip it entirely for
    // BOTH scopes -- no streak there is ever visible to its members.
    const resolver: GuildResolver = isGuildResolver(guilds) ? guilds : iterableGuildResolver(guilds);
    const members = new Map<string, GuildLike>(); // serverId -> guild (bot is in it)
    for (const serverId of serverDates.keys()) {
      const guild = await resolver.resolve(serverId);
      if (guild) members.set(serverId, guild);
    }

    // Advance server scopes -- only for guilds the bot is in.
    for (const [serverId, dates] of serverDates) {
      if (!members.has(serverId)) continue;
      await streakRepo.advance('server', serverId, gameType, [...dates]);
    }
    // Advance player scopes -- only in guilds the bot is in.
    for (const [pKey, dates] of playerDates) {
      const { serverId, userId } = playerKeys.get(pKey)!;
      if (!members.has(serverId)) continue;
      await streakRepo.advance('player', serverId, gameType, [...dates], userId);
    }

    // Lapse handling: zero every active streak for this game whose last counted
    // day is older than latestDate. One set-based UPDATE covers both scopes AND
    // scopes that stopped playing entirely (which wouldn't appear above).
    await streakRepo.resetAllLapsed(gameType, latestDate);

    // Capture guild display metadata for the public leaderboard, reusing the
    // guilds already resolved above (no second fetch). Only bot-member guilds
    // are present in `members`, so only they get named/ranked.
    let named = 0;
    for (const [serverId, guild] of members) {
      await streakRepo.upsertServerMeta(serverId, gameType, guild.name, guild.icon);
      named++;
    }

    logger.info(`[streaks] updated ${members.size}/${serverDates.size} member-server(s), ${playerDates.size} player-scope(s), named ${named} for ${gameType}`);
  } catch (e) {
    // Never let streak bookkeeping break the daily post.
    logger.error('[streaks] update failed', { gameType, error: e });
  }
}

/** Structural check: does this value look like a {@link GuildResolver}? */
function isGuildResolver(x: GuildResolver | Iterable<GuildLike>): x is GuildResolver {
  return typeof (x as GuildResolver).resolve === 'function';
}
