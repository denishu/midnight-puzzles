// End-to-end test for the daily midnight recap flow (IMPROVEMENTS #10).
//
// The bots' postDailyPuzzleMessage() is tightly coupled to the Discord client
// (guild loop + channel.send), which isn't worth mocking. But the DATA logic it
// depends on — pulling yesterday's completed sessions, grouping them by server,
// advancing the per-server streak, and purging >7-day-old sessions — is the part
// that actually breaks, and it runs entirely against the repositories. This test
// drives those real repositories over in-memory SQLite and asserts the behavior,
// including the streak state machine the bots implement inline.

import { DatabaseConnectionFactory } from '../../core/storage/DatabaseConnection';
import { GameStateRepository, GameSession } from '../../core/storage/GameStateRepository';
import { UserRepository } from '../../core/storage/UserRepository';
import { ConfigRepository } from '../../core/storage/ConfigRepository';
import { MigrationManager } from '../../core/storage/migrations/migrate';

const GAME = 'travle';

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}
const dateStr = (d: Date) => d.toISOString().split('T')[0]!;

/**
 * Replicates the streak transition the bots compute inline:
 *   win  -> continue (+1) if the last streak date was the day before, else 1
 *   loss -> 0
 */
function nextStreak(prev: { count: number; lastDate: string }, anyWin: boolean, yesterday: Date): number {
  if (!anyWin) return 0;
  const dayBefore = dateStr(new Date(yesterday.getTime() - 86400000));
  return prev.lastDate === dayBefore ? prev.count + 1 : 1;
}

describe('Daily midnight recap flow (e2e)', () => {
  let sessionRepo: GameStateRepository;
  let userRepo: UserRepository;
  let configRepo: ConfigRepository;

  beforeAll(async () => {
    await DatabaseConnectionFactory.close();
    const db = await DatabaseConnectionFactory.create({ type: 'sqlite', database: ':memory:' });
    await new MigrationManager(db).migrate();
    sessionRepo = new GameStateRepository(db);
    userRepo = new UserRepository(db);
    configRepo = new ConfigRepository(db);
  });

  afterAll(async () => {
    await DatabaseConnectionFactory.close();
  });

  /** Seed a completed session for a user in a server on a given puzzle date. */
  async function seedCompleted(userId: string, serverId: string, puzzleDate: Date, isWin: boolean) {
    await userRepo.upsertUser(userId, 'user_' + userId);
    const created = await sessionRepo.createSession({
      userId, serverId, gameType: GAME, puzzleDate, maxAttempts: 10,
      gameData: { guesses: [{ country: 'mali', status: 'green' }] },
    });
    await sessionRepo.completeSession(created.id, { isWin, guessCount: 3, shortestPath: 4 });
    return created.id;
  }

  /**
   * Ensure a server_configs row exists. updateStreak() merges into
   * custom_settings via an UPDATE (not an upsert), so a server with no config
   * row would silently drop the write — the bots' servers have a row from
   * /setchannel, so tests must establish one too.
   */
  async function ensureServerConfig(serverId: string) {
    await configRepo.upsertServerConfig(serverId, {});
  }

  it("pulls yesterday's completed sessions and groups them by server", async () => {
    const yesterday = daysAgo(1);
    await seedCompleted('u1', 'serverA', yesterday, true);
    await seedCompleted('u2', 'serverA', yesterday, false);
    await seedCompleted('u3', 'serverB', yesterday, true);
    // A session for TODAY must NOT appear in yesterday's recap.
    await seedCompleted('u4', 'serverA', daysAgo(0), true);

    const sessions = await sessionRepo.getCompletedSessionsForDate(GAME, yesterday);

    type RecapSession = GameSession & { username: string };
    const byServer = new Map<string, RecapSession[]>();
    for (const s of sessions) {
      const list = byServer.get(s.serverId) || [];
      list.push(s);
      byServer.set(s.serverId, list);
    }

    expect(byServer.get('serverA')!.map((s: RecapSession) => s.userId).sort()).toEqual(['u1', 'u2']);
    expect(byServer.get('serverB')!.map((s: RecapSession) => s.userId)).toEqual(['u3']);
    // Sessions carry the joined username (used in recap lines).
    expect(sessions.every((s: RecapSession) => typeof s.username === 'string' && s.username.length > 0)).toBe(true);
  });

  describe('streak state machine (per server, persisted via ConfigRepository)', () => {
    it('starts a streak at 1 on the first win', async () => {
      const server = 'streak1';
      await ensureServerConfig(server);
      const yesterday = daysAgo(1);
      const prev = await configRepo.getStreak(server, GAME);
      expect(prev).toEqual({ count: 0, lastDate: '' });

      const next = nextStreak(prev, true, yesterday);
      await configRepo.updateStreak(server, GAME, next, dateStr(yesterday));

      expect(next).toBe(1);
      expect(await configRepo.getStreak(server, GAME)).toEqual({ count: 1, lastDate: dateStr(yesterday) });
    });

    it('continues the streak (+1) when the prior streak date was the day before', async () => {
      const server = 'streak2';
      await ensureServerConfig(server);
      const yesterday = daysAgo(1);
      // Prior streak recorded for the day-before-yesterday.
      await configRepo.updateStreak(server, GAME, 3, dateStr(daysAgo(2)));

      const prev = await configRepo.getStreak(server, GAME);
      const next = nextStreak(prev, true, yesterday);
      await configRepo.updateStreak(server, GAME, next, dateStr(yesterday));

      expect(next).toBe(4);
      expect((await configRepo.getStreak(server, GAME)).count).toBe(4);
    });

    it('restarts the streak at 1 after a gap (win, but prior date not contiguous)', async () => {
      const server = 'streak3';
      await ensureServerConfig(server);
      const yesterday = daysAgo(1);
      // Prior streak is stale (5 days ago) — a gap.
      await configRepo.updateStreak(server, GAME, 9, dateStr(daysAgo(5)));

      const prev = await configRepo.getStreak(server, GAME);
      const next = nextStreak(prev, true, yesterday);

      expect(next).toBe(1);
    });

    it('resets the streak to 0 on a no-win day', async () => {
      const server = 'streak4';
      await ensureServerConfig(server);
      const yesterday = daysAgo(1);
      await configRepo.updateStreak(server, GAME, 6, dateStr(daysAgo(2)));

      const prev = await configRepo.getStreak(server, GAME);
      const next = nextStreak(prev, false, yesterday);

      expect(prev.count).toBe(6); // prior streak persisted (row exists)
      expect(next).toBe(0);
    });
  });

  it('deleteOldSessions(7) purges >7-day-old sessions but keeps recent ones', async () => {
    const server = 'cleanup';
    const oldId = await seedCompleted('old_u', server, daysAgo(10), true);
    const recentId = await seedCompleted('recent_u', server, daysAgo(2), true);

    await sessionRepo.deleteOldSessions(7);

    expect(await sessionRepo.getSession(oldId)).toBeNull();
    expect(await sessionRepo.getSession(recentId)).not.toBeNull();
  });
});
