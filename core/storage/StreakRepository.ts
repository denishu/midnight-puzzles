import { DatabaseConnection } from './DatabaseConnection';
import { Logger } from '../utils/Logger';

/** A single streak record (either a player or a server aggregate). */
export interface StreakRecord {
  scope: 'player' | 'server';
  serverId: string;
  userId: string; // '' for server-scope rows
  gameType: string;
  currentCount: number;
  currentLastDate: string | null; // 'YYYY-MM-DD'
  maxCount: number;
  maxDate: string | null;
}

/** A row returned by the public top-servers leaderboard query. */
export interface TopServerEntry {
  serverId: string;
  gameType: string;
  maxCount: number;
  maxDate: string | null;
  currentCount: number;
  guildName: string | null;
  iconHash: string | null;
}

/** Server ids that are synthetic (not real guilds) and excluded from boards. */
export function isSyntheticServer(serverId: string): boolean {
  return serverId === 'activity' || serverId === 'dm' || serverId === '';
}

/** User ids that are not real Discord accounts and excluded from boards. */
export function isSyntheticUser(userId: string): boolean {
  return userId === 'default' || userId.startsWith('local_');
}

const SERVER_USER_SENTINEL = '';

/** Add n days to a 'YYYY-MM-DD' string, returning 'YYYY-MM-DD' (UTC-safe). */
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00.000Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0]!;
}

/**
 * Repository for persisted streak state (migration v3).
 *
 * Streaks must be persisted rather than computed on demand because
 * game_sessions are purged after 7 days -- a 30-day streak has no surviving raw
 * rows to recompute from. This repo stores the running count and the all-time
 * max per scope, and advances them idempotently from whatever completed days
 * are still in the retention window.
 *
 * Scopes:
 *  - 'player': (server_id, user_id, game_type) -- a user's streak IN A SERVER.
 *    A day with no completion in that server breaks that server's streak, even
 *    if the user completed the same game in a different server that day.
 *  - 'server': (server_id, game_type), user_id = '' -- the server kept a daily
 *    win going (any member completed).
 *
 * All SQL is portable (?-placeholders, no engine-specific functions); date math
 * is done in TS so SQLite/Postgres date-function differences never bite.
 */
export class StreakRepository {
  private db: DatabaseConnection;
  private logger: Logger;

  constructor(db: DatabaseConnection) {
    this.db = db;
    this.logger = new Logger('StreakRepository');
  }

  /** Fetch a single streak record, or null if none exists yet. */
  async getStreak(scope: 'player' | 'server', serverId: string, gameType: string, userId = SERVER_USER_SENTINEL): Promise<StreakRecord | null> {
    const uid = scope === 'server' ? SERVER_USER_SENTINEL : userId;
    const rows = await this.db.query<any>(
      `SELECT * FROM streaks WHERE scope = ? AND server_id = ? AND user_id = ? AND game_type = ?`,
      [scope, serverId, uid, gameType]
    );
    return rows.length ? this.mapRow(rows[0]) : null;
  }

  /** Convenience: a player's streak in a given server/game. */
  async getPlayerStreak(userId: string, serverId: string, gameType: string): Promise<StreakRecord | null> {
    return this.getStreak('player', serverId, gameType, userId);
  }

  /** Convenience: the server-aggregate streak for a server/game. */
  async getServerStreak(serverId: string, gameType: string): Promise<StreakRecord | null> {
    return this.getStreak('server', serverId, gameType);
  }

  /**
   * Advance a streak to account for a set of completed puzzle-dates, applying
   * the consecutive-day rule. Idempotent: dates on or before the stored
   * current_last_date are ignored, so re-running the same day (or after a short
   * outage within the 7-day window) does not double-count or corrupt state.
   *
   * Rule, applied date-by-date in ascending order for each completed day D:
   *   - if D == currentLastDate + 1  -> currentCount += 1   (contiguous)
   *   - else (gap or first)          -> currentCount  = 1   (restart)
   *   - currentLastDate = D
   *   - maxCount/maxDate bumped whenever currentCount exceeds maxCount
   *
   * Note: this method ONLY advances on completed days. "A missed day resets the
   * active streak to 0" is handled by {@link resetIfLapsed}, which the nightly
   * job calls for scopes that did NOT complete on the just-finished day.
   */
  async advance(
    scope: 'player' | 'server',
    serverId: string,
    gameType: string,
    completedDates: string[],
    userId = SERVER_USER_SENTINEL,
  ): Promise<StreakRecord> {
    const uid = scope === 'server' ? SERVER_USER_SENTINEL : userId;
    const existing = await this.getStreak(scope, serverId, gameType, uid);

    let current = existing?.currentCount ?? 0;
    let lastDate = existing?.currentLastDate ?? null;
    let maxCount = existing?.maxCount ?? 0;
    let maxDate = existing?.maxDate ?? null;

    // Only consider days strictly after the last counted day, in order.
    const dates = [...new Set(completedDates)]
      .filter(d => !lastDate || d > lastDate)
      .sort();

    for (const d of dates) {
      if (lastDate && d === addDays(lastDate, 1)) {
        current += 1;
      } else {
        current = 1;
      }
      lastDate = d;
      if (current > maxCount) {
        maxCount = current;
        maxDate = d;
      }
    }

    await this.upsert({ scope, serverId, userId: uid, gameType, currentCount: current, currentLastDate: lastDate, maxCount, maxDate });
    return { scope, serverId, userId: uid, gameType, currentCount: current, currentLastDate: lastDate, maxCount, maxDate };
  }

  /**
   * Reset the ACTIVE streak to 0 if it lapsed: i.e. the scope did not complete
   * on `expectedDate` (the just-finished day) and its current_last_date is now
   * older than `expectedDate`. Preserves max_count/max_date. No-op if the scope
   * has no row, or if its streak already covers expectedDate (it completed).
   */
  async resetIfLapsed(
    scope: 'player' | 'server',
    serverId: string,
    gameType: string,
    expectedDate: string,
    userId = SERVER_USER_SENTINEL,
  ): Promise<void> {
    const uid = scope === 'server' ? SERVER_USER_SENTINEL : userId;
    const existing = await this.getStreak(scope, serverId, gameType, uid);
    if (!existing || existing.currentCount === 0) return;
    // If the last counted day is the expected day (or later), it's still live.
    if (existing.currentLastDate && existing.currentLastDate >= expectedDate) return;

    await this.upsert({ ...existing, currentCount: 0 });
  }

  /**
   * Set-based reset of EVERY lapsed active streak for a game, regardless of
   * whether the scope had any recent activity. A streak is lapsed if its
   * current_count > 0 but its current_last_date is strictly before
   * `expectedDate` (the just-finished day). Preserves max_count/max_date.
   *
   * This complements {@link resetIfLapsed}: the nightly job can only enumerate
   * scopes that appear in the recent-sessions window, but a scope that stopped
   * playing entirely (no completions in the whole retention window) still needs
   * its stale active streak zeroed. One UPDATE handles all of them.
   */
  async resetAllLapsed(gameType: string, expectedDate: string): Promise<number> {
    const sql = `
      UPDATE streaks
      SET current_count = 0, updated_at = CURRENT_TIMESTAMP
      WHERE game_type = ?
        AND current_count > 0
        AND (current_last_date IS NULL OR current_last_date < ?)
    `;
    const res = await this.db.query(sql, [gameType, expectedDate]);
    return (res as any)?.length ?? 0;
  }

  /** Insert or update a streak row (portable upsert via ON CONFLICT on PK). */
  async upsert(rec: StreakRecord): Promise<void> {
    const sql = `
      INSERT INTO streaks (scope, server_id, user_id, game_type, current_count, current_last_date, max_count, max_date, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (scope, server_id, user_id, game_type)
      DO UPDATE SET
        current_count = excluded.current_count,
        current_last_date = excluded.current_last_date,
        max_count = excluded.max_count,
        max_date = excluded.max_date,
        updated_at = CURRENT_TIMESTAMP
    `;
    await this.db.query(sql, [
      rec.scope, rec.serverId, rec.userId, rec.gameType,
      rec.currentCount, rec.currentLastDate, rec.maxCount, rec.maxDate,
    ]);
  }

  /**
   * Delete ALL streak rows (both scopes, all users) for a server+game. Used to
   * purge streaks accrued in guilds the bot is NOT a member of -- those are
   * created only by user-installed Activity launches, surface nothing to the
   * guild's members (no embed, no /streak, no daily prompt), and must not
   * appear on the public leaderboard. Returns the number of rows removed.
   */
  async deleteServer(serverId: string, gameType: string): Promise<number> {
    const rows = await this.db.query<any>(
      `SELECT COUNT(*) AS n FROM streaks WHERE server_id = ? AND game_type = ?`,
      [serverId, gameType]
    );
    const n = Number(rows[0]?.n ?? 0);
    await this.db.query(
      `DELETE FROM streaks WHERE server_id = ? AND game_type = ?`,
      [serverId, gameType]
    );
    return n;
  }

  /**
   * Record a server's display metadata (name + icon hash) on its server-scope
   * row so the public leaderboard can render it. Upserts the server row,
   * creating it with zeroed counts if it does not exist yet. Only updates the
   * metadata columns; never touches streak counts.
   */
  async upsertServerMeta(serverId: string, gameType: string, guildName: string | null, iconHash: string | null): Promise<void> {
    const sql = `
      INSERT INTO streaks (scope, server_id, user_id, game_type, guild_name, icon_hash, updated_at)
      VALUES ('server', ?, '', ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT (scope, server_id, user_id, game_type)
      DO UPDATE SET
        guild_name = excluded.guild_name,
        icon_hash = excluded.icon_hash,
        updated_at = CURRENT_TIMESTAMP
    `;
    await this.db.query(sql, [serverId, gameType, guildName, iconHash]);
  }

  /**
   * Top N servers for a game, ranked by all-time max streak. Excludes synthetic
   * servers (activity/dm/empty). Ties broken by higher current streak, then by
   * most recent max_date. Used by the public /api/leaderboard endpoint.
   */
  async getTopServers(gameType: string, limit = 5): Promise<TopServerEntry[]> {
    const sql = `
      SELECT server_id, game_type, max_count, max_date, current_count, guild_name, icon_hash
      FROM streaks
      WHERE scope = 'server'
        AND game_type = ?
        AND max_count > 0
        AND server_id NOT IN ('activity', 'dm', '')
      ORDER BY max_count DESC, current_count DESC, max_date DESC
      LIMIT ?
    `;
    const rows = await this.db.query<any>(sql, [gameType, limit]);
    return rows.map(r => ({
      serverId: r.server_id,
      gameType: r.game_type,
      maxCount: r.max_count,
      maxDate: r.max_date ?? null,
      currentCount: r.current_count,
      guildName: r.guild_name ?? null,
      iconHash: r.icon_hash ?? null,
    }));
  }

  /**
   * The most recent time any server-scope streak row for this game was written
   * (its `updated_at`). This reflects when the data the leaderboard shows was
   * ACTUALLY last updated by the nightly job -- not when the HTTP response was
   * built -- so the page can show an honest "Updated <date>" even if a nightly
   * run was missed. Returns null when there are no server rows yet.
   */
  async getServersLastUpdated(gameType: string): Promise<string | null> {
    const sql = `
      SELECT MAX(updated_at) AS last_updated
      FROM streaks
      WHERE scope = 'server' AND game_type = ? AND server_id NOT IN ('activity', 'dm', '')
    `;
    const rows = await this.db.query<any>(sql, [gameType]);
    const raw = rows[0]?.last_updated ?? null;
    if (!raw) return null;
    // SQLite stores CURRENT_TIMESTAMP as naive UTC ("YYYY-MM-DD HH:MM:SS" with
    // no zone); Postgres returns a Date/ISO string. Normalize to an explicit
    // UTC ISO-8601 string so clients (and tests) parse it unambiguously as UTC
    // rather than mis-reading the naive form as local time.
    if (raw instanceof Date) return raw.toISOString();
    const s = String(raw);
    // Already has zone/offset or a 'T' separator -> trust it.
    if (/[zZ]|[+-]\d{2}:\d{2}$/.test(s) || s.includes('T')) {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? s : d.toISOString();
    }
    // Naive "YYYY-MM-DD HH:MM:SS" -> treat as UTC.
    const d = new Date(s.replace(' ', 'T') + 'Z');
    return Number.isNaN(d.getTime()) ? s : d.toISOString();
  }

  private mapRow(row: any): StreakRecord {
    return {
      scope: row.scope,
      serverId: row.server_id,
      userId: row.user_id ?? '',
      gameType: row.game_type,
      currentCount: row.current_count ?? 0,
      currentLastDate: row.current_last_date ?? null,
      maxCount: row.max_count ?? 0,
      maxDate: row.max_date ?? null,
    };
  }
}
