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
  result?: Record<string, any> | null;
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
 * Whether a completed session counts as a WIN for streak purposes.
 *
 * Streaks are consecutive-day *wins*, not merely consecutive attempts, so a
 * completed-but-lost game (travle/duotrigordle running out of guesses) must NOT
 * extend a streak. The win signal lives in `result.isWin` (set by
 * completeSession) and, as a fallback, `game_data.isWin`.
 *
 * Semantics are the INVERSE of an explicit loss -- a session wins unless it is
 * explicitly marked `isWin === false` -- deliberately matching the daily
 * recap's own check (`s.result?.isWin !== false`). This is required for
 * per-game correctness:
 *   - travle / duotrigordle set `isWin: false` on a loss  -> excluded.
 *   - semantle has no fail-state; completions may not set `isWin` to `true`
 *     at all (undefined) -> still counted, exactly as the recap treats them.
 *
 * Callers should gate on {@link isSessionComplete} first; this only decides
 * win-vs-loss for sessions that are already complete.
 */
export function isSessionWin(session: CompletableSession): boolean {
  const resultWin = session.result && typeof session.result === 'object'
    ? (session.result as Record<string, unknown>).isWin
    : undefined;
  if (resultWin === false || resultWin === 0 || resultWin === '0') return false;
  if (resultWin === true || resultWin === 1 || resultWin === '1') return true;

  // Fall back to the game_data marker when result didn't carry isWin.
  const data = session.gameData;
  if (data && typeof data === 'object') {
    const marker = (data as Record<string, unknown>).isWin;
    if (marker === false || marker === 0 || marker === '0') return false;
  }

  // No explicit loss signal anywhere -> treat as a win (matches recap).
  return true;
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
