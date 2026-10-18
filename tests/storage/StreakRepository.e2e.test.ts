// End-to-end tests for the per-server streak leaderboard feature.
//
// Mirrors tests/bot/DailyRecap.e2e.test.ts: drives the REAL repositories over
// in-memory SQLite (the same engine as prod) and asserts the streak state
// machine, the migration shape, the gap-tolerant nightly update helper, and the
// public top-servers query. Date math is done in TS, so these tests are
// deterministic regardless of the host's timezone.

import { DatabaseConnectionFactory } from '../../core/storage/DatabaseConnection';
import { GameStateRepository } from '../../core/storage/GameStateRepository';
import { UserRepository } from '../../core/storage/UserRepository';
import { StreakRepository } from '../../core/storage/StreakRepository';
import { MigrationManager } from '../../core/storage/migrations/migrate';
import { updateStreaks, GuildLike } from '../../bot/shared/updateStreaks';
import { Logger } from '../../core/utils/Logger';

const GAME = 'travle';
const logger = new Logger('test');

async function freshDb() {
  await DatabaseConnectionFactory.close();
  const db = await DatabaseConnectionFactory.create({ type: 'sqlite', database: ':memory:' });
  await new MigrationManager(db).migrate();
  return db;
}

describe('migration v3: streaks table', () => {
  afterAll(async () => { await DatabaseConnectionFactory.close(); });

  it('creates the streaks table with the expected columns and indexes', async () => {
    const db = await freshDb();

    const migs = await db.query<{ version: number }>('SELECT version FROM migrations ORDER BY version');
    expect(migs.map(m => m.version)).toContain(3);

    const cols = (await db.query<{ name: string }>("PRAGMA table_info('streaks')")).map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining([
      'scope', 'server_id', 'user_id', 'game_type',
      'current_count', 'current_last_date', 'max_count', 'max_date',
      'guild_name', 'icon_hash', 'updated_at',
    ]));

    const idx = (await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='streaks' AND name NOT LIKE 'sqlite_%'"
    )).map(i => i.name);
    expect(idx).toEqual(expect.arrayContaining(['idx_streaks_top_servers', 'idx_streaks_player']));
  });

  it('is idempotent: re-running migrate applies nothing new', async () => {
    const db = await freshDb();
    const before = (await db.query('SELECT COUNT(*) AS n FROM migrations'))[0].n;
    await new MigrationManager(db).migrate();
    const after = (await db.query('SELECT COUNT(*) AS n FROM migrations'))[0].n;
    expect(after).toBe(before);
  });
});

describe('StreakRepository state machine', () => {
  let repo: StreakRepository;

  beforeEach(async () => {
    const db = await freshDb();
    repo = new StreakRepository(db);
  });
  afterAll(async () => { await DatabaseConnectionFactory.close(); });

  it('starts a streak at 1 on the first completed day', async () => {
    const r = await repo.advance('player', 'S1', GAME, ['2026-10-01'], 'U1');
    expect(r.currentCount).toBe(1);
    expect(r.maxCount).toBe(1);
    expect(r.currentLastDate).toBe('2026-10-01');
  });

  it('increments on consecutive days and tracks max', async () => {
    const r = await repo.advance('player', 'S1', GAME, ['2026-10-01', '2026-10-02', '2026-10-03'], 'U1');
    expect(r.currentCount).toBe(3);
    expect(r.maxCount).toBe(3);
    expect(r.maxDate).toBe('2026-10-03');
  });

  it('restarts at 1 after a gap, preserving max', async () => {
    await repo.advance('player', 'S1', GAME, ['2026-10-01', '2026-10-02', '2026-10-03'], 'U1');
    const r = await repo.advance('player', 'S1', GAME, ['2026-10-07'], 'U1'); // gap
    expect(r.currentCount).toBe(1);
    expect(r.maxCount).toBe(3);
    expect(r.maxDate).toBe('2026-10-03');
  });

  it('is idempotent: replaying already-counted days changes nothing', async () => {
    const days = ['2026-10-01', '2026-10-02', '2026-10-03'];
    await repo.advance('player', 'S1', GAME, days, 'U1');
    const r = await repo.advance('player', 'S1', GAME, days, 'U1');
    expect(r.currentCount).toBe(3);
    expect(r.maxCount).toBe(3);
  });

  it('resetIfLapsed zeroes an active streak that missed the expected day, keeping max', async () => {
    await repo.advance('player', 'S1', GAME, ['2026-10-01', '2026-10-02'], 'U1');
    await repo.resetIfLapsed('player', 'S1', GAME, '2026-10-04', 'U1'); // missed 10-03/10-04
    const s = await repo.getPlayerStreak('U1', 'S1', GAME);
    expect(s!.currentCount).toBe(0);
    expect(s!.maxCount).toBe(2);
  });

  it('resetIfLapsed is a no-op when the streak already covers the expected day', async () => {
    await repo.advance('player', 'S1', GAME, ['2026-10-01', '2026-10-02'], 'U1');
    await repo.resetIfLapsed('player', 'S1', GAME, '2026-10-02', 'U1');
    const s = await repo.getPlayerStreak('U1', 'S1', GAME);
    expect(s!.currentCount).toBe(2);
  });

  it("reproduces the user's cross-server scenario (S1 active 1/best 5, S2 active 0/best 1)", async () => {
    // Days 1-5 in S1, day 6 in S2, day 7 back in S1.
    await repo.advance('player', 'S1', GAME, ['2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05'], 'U1');
    await repo.advance('player', 'S2', GAME, ['2026-10-06'], 'U1');
    await repo.advance('player', 'S1', GAME, ['2026-10-07'], 'U1'); // gap on day 6 in S1

    // On day 7, S2 did not complete -> lapsed.
    await repo.resetIfLapsed('player', 'S2', GAME, '2026-10-07', 'U1');

    const s1 = await repo.getPlayerStreak('U1', 'S1', GAME);
    const s2 = await repo.getPlayerStreak('U1', 'S2', GAME);
    expect(s1!.currentCount).toBe(1);
    expect(s1!.maxCount).toBe(5);
    expect(s2!.currentCount).toBe(0);
    expect(s2!.maxCount).toBe(1);
  });

  it('resetAllLapsed zeroes stale streaks across scopes in one pass', async () => {
    await repo.advance('player', 'S1', GAME, ['2026-10-01', '2026-10-02'], 'U1'); // last 10-02
    await repo.advance('server', 'S1', GAME, ['2026-10-05']);                     // last 10-05
    await repo.resetAllLapsed(GAME, '2026-10-05'); // player (10-02) lapses; server (10-05) stays

    expect((await repo.getPlayerStreak('U1', 'S1', GAME))!.currentCount).toBe(0);
    expect((await repo.getServerStreak('S1', GAME))!.currentCount).toBe(1);
  });

  it('getTopServers ranks by max and excludes synthetic servers', async () => {
    await repo.advance('server', 'S1', GAME, ['2026-10-01','2026-10-02','2026-10-03','2026-10-04','2026-10-05']); // 5
    await repo.advance('server', 'S2', GAME, ['2026-10-01','2026-10-02']);                                        // 2
    await repo.advance('server', 'activity', GAME, ['2026-10-01','2026-10-02','2026-10-03']);                     // synthetic
    await repo.upsertServerMeta('S1', GAME, 'Alpha', 'hash1');
    await repo.upsertServerMeta('S2', GAME, null, null);

    const top = await repo.getTopServers(GAME, 5);
    expect(top.map(t => t.serverId)).toEqual(['S1', 'S2']); // activity excluded
    expect(top[0]!.maxCount).toBe(5);
    expect(top[0]!.guildName).toBe('Alpha');
    expect(top[0]!.iconHash).toBe('hash1');
    expect(top[1]!.iconHash).toBeNull();
  });
});

describe('updateStreaks nightly helper (gap-tolerant, over real sessions)', () => {
  let sessionRepo: GameStateRepository;
  let userRepo: UserRepository;
  let streakRepo: StreakRepository;

  const guilds: GuildLike[] = [{ id: 'S1', name: 'Alpha Server', icon: 'iconhash' }];

  beforeEach(async () => {
    const db = await freshDb();
    sessionRepo = new GameStateRepository(db);
    userRepo = new UserRepository(db);
    streakRepo = new StreakRepository(db);
  });
  afterAll(async () => { await DatabaseConnectionFactory.close(); });

  function dateNDaysAgo(n: number): Date {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    d.setUTCHours(0, 0, 0, 0);
    return d;
  }

  async function seed(userId: string, serverId: string, date: Date, isWin = true) {
    await userRepo.upsertUser(userId, 'user_' + userId);
    const s = await sessionRepo.createSession({ userId, serverId, gameType: GAME, puzzleDate: date, maxAttempts: 10, gameData: {} });
    await sessionRepo.completeSession(s.id, { isWin });
  }

  it('advances both player and server scopes from completed sessions in the window', async () => {
    // Two consecutive days of play by U1 in S1.
    await seed('U1', 'S1', dateNDaysAgo(2));
    await seed('U1', 'S1', dateNDaysAgo(1));

    await updateStreaks(GAME, sessionRepo, streakRepo, guilds, logger);

    const player = await streakRepo.getPlayerStreak('U1', 'S1', GAME);
    const server = await streakRepo.getServerStreak('S1', GAME);
    expect(player!.currentCount).toBe(2);
    expect(player!.maxCount).toBe(2);
    expect(server!.currentCount).toBe(2);
    // Guild metadata captured for the leaderboard.
    expect(server!.serverId).toBe('S1');
    const top = await streakRepo.getTopServers(GAME, 5);
    expect(top[0]!.guildName).toBe('Alpha Server');
    expect(top[0]!.iconHash).toBe('iconhash');
  });

  it('excludes synthetic servers and synthetic users', async () => {
    await seed('U1', 'activity', dateNDaysAgo(1));          // synthetic server
    await seed('local_abc', 'S1', dateNDaysAgo(1));         // synthetic user

    await updateStreaks(GAME, sessionRepo, streakRepo, guilds, logger);

    expect(await streakRepo.getServerStreak('activity', GAME)).toBeNull();
    expect(await streakRepo.getPlayerStreak('local_abc', 'S1', GAME)).toBeNull();
  });

  it('is idempotent across repeated runs (e.g. re-run after a restart)', async () => {
    await seed('U1', 'S1', dateNDaysAgo(2));
    await seed('U1', 'S1', dateNDaysAgo(1));

    await updateStreaks(GAME, sessionRepo, streakRepo, guilds, logger);
    await updateStreaks(GAME, sessionRepo, streakRepo, guilds, logger); // re-run

    const player = await streakRepo.getPlayerStreak('U1', 'S1', GAME);
    expect(player!.currentCount).toBe(2);
    expect(player!.maxCount).toBe(2);
  });

  it('recovers a missed day within the window (gap tolerance)', async () => {
    // Simulate: bot was down, so 3 consecutive days are all still present when
    // it finally runs. The streak should reach 3, not be stuck at 1.
    await seed('U1', 'S1', dateNDaysAgo(3));
    await seed('U1', 'S1', dateNDaysAgo(2));
    await seed('U1', 'S1', dateNDaysAgo(1));

    await updateStreaks(GAME, sessionRepo, streakRepo, guilds, logger);

    const player = await streakRepo.getPlayerStreak('U1', 'S1', GAME);
    expect(player!.currentCount).toBe(3);
  });
});
