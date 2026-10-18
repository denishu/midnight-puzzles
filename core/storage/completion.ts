/**
 * Shared completion predicate for game sessions.
 *
 * Completion is stored inconsistently across the three games: some set the
 * `is_complete` boolean column (semantle, duotrigordle), while others only
 * reflect it in the `game_data` JSON (travle historically set
 * `game_data.isComplete` without always flipping the column). The daily recap
 * query already works around this by checking BOTH the column and the JSON
 * markers (see GameStateRepository.getCompletedSessionsForDate). Streak math
 * must use the exact same definition, or per-game streaks would be wrong.
 *
 * This is the single source of truth for "did this session count as a
 * completion?" Use it everywhere streaks or leaderboards are computed.
 */

/** Minimal shape needed to decide completion -- works on mapped sessions. */
export interface CompletableSession {
  isComplete?: boolean;
  gameData?: Record<string, any> | null;
}

/**
 * Whether a session counts as completed for streak/leaderboard purposes.
 *
 * True if either:
 *  - the `is_complete` boolean is set, OR
 *  - the game-specific state in `game_data` marks it complete
 *    (`isComplete: true`, or a `result` object, matching the recap's behavior).
 */
export function isSessionComplete(session: CompletableSession): boolean {
  // SQLite returns the boolean column as the number 1 (not `true`), while
  // Postgres returns a real boolean. Treat any truthy value (true or 1) as
  // complete so streak math matches the SQL-level predicate used by the
  // windowed query and the recap.
  const flag = session.isComplete as unknown;
  if (flag === true || flag === 1 || flag === '1') return true;

  const data = session.gameData;
  if (data && typeof data === 'object') {
    const marker = (data as Record<string, unknown>).isComplete;
    if (marker === true || marker === 1 || marker === '1') return true;
  }

  return false;
}

/**
 * SQL fragment mirroring {@link isSessionComplete} for use inside queries that
 * filter completed rows directly (kept portable across SQLite/Postgres -- only
 * uses LIKE, no JSON operators). Column alias defaults match game_sessions.
 *
 * Returns a predicate string; callers interpolate it into a WHERE clause. It
 * references the raw columns `is_complete` and `game_data`, so qualify with a
 * table alias by passing one (e.g. 'gs').
 */
export function completedSqlPredicate(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return (
    `(${p}is_complete = 1 ` +
    `OR ${p}game_data LIKE '%"isComplete":true%' ` +
    `OR ${p}game_data LIKE '%"isComplete": true%')`
  );
}
