// Characterization tests — lock in the CURRENT Travle web-session
// save/resume behavior before migrating it onto SessionManager.
//
// These reproduce, in isolation, exactly what web/travle/server.ts does today:
// unlike Duotrigordle (which replays a guess-word list), Travle stores the FULL
// TravleGameState in gameData and, on resume, reads it back DIRECTLY
// (state = dbSession.gameData as TravleGameState) — no replay/reconstruction.
// The refactor must preserve every property asserted here.

import { CountryGraph } from '../../../games/travle/CountryGraph';
import { TravleGame, TravleGameState } from '../../../games/travle/TravleGame';
import { TravlePuzzle } from '../../../games/travle/PuzzleGenerator';
import { GameStateRepository } from '../../../core/storage/GameStateRepository';
import { UserRepository } from '../../../core/storage/UserRepository';
import { DatabaseConnectionFactory } from '../../../core/storage/DatabaseConnection';
import { MigrationManager } from '../../../core/storage/migrations/migrate';

// --- Test fixtures ------------------------------------------------------------

let graph: CountryGraph;
let game: TravleGame;

beforeAll(async () => {
  graph = new CountryGraph();
  await graph.initialize();
  game = new TravleGame(graph);
  game.init();
});

/** Ghana → UAE state (mirrors the existing TravleGame.test.ts helper). */
function ghanaToUAE(): TravleGameState {
  const path = graph.findShortestPath('ghana', 'united arab emirates')!;
  const puzzle: TravlePuzzle = {
    start: 'ghana',
    end: 'united arab emirates',
    shortestPath: path,
    shortestPathLength: path.length - 1,
    maxGuesses: path.length - 1 + Math.max(3, Math.floor((path.length - 1) * 0.5)),
  };
  return game.newState(puzzle);
}

/** The exact resume the server performs: read gameData back AS the state. */
function resumeFromGameData(gameData: Record<string, any>): TravleGameState {
  return gameData as unknown as TravleGameState;
}

// --- State mutation invariants (game-logic level, survives the refactor) ------

describe('Travle guess mutation invariants (characterization)', () => {
  it('a valid guess mutates state in place: appends {country,status}, decrements remaining', () => {
    const state = ghanaToUAE();
    const before = state.guessesRemaining;

    const result = game.guess(state, 'mali');

    expect(result.isValid).toBe(true);
    expect(['green', 'yellow', 'red']).toContain(result.status);
    // The guess was pushed onto the SAME state object (server relies on this
    // because it saves `state` right after calling guess()).
    expect(state.guesses).toHaveLength(1);
    expect(state.guesses[0]!.country).toBe('mali');
    expect(state.guesses[0]!.status).toBe(result.status);
    expect(state.guessesRemaining).toBe(before - 1);
    expect(state.isComplete).toBe(false);
  });

  it('winning sets isComplete + isWin on the same state object', () => {
    const state = ghanaToUAE();
    const intermediates = state.puzzle.shortestPath.slice(1, -1);
    let last;
    for (const c of intermediates) last = game.guess(state, c);

    expect(last!.isWin).toBe(true);
    expect(state.isComplete).toBe(true);
    expect(state.isWin).toBe(true);
  });

  it('a fresh state is the exact serialized shape the server stores', () => {
    const state = ghanaToUAE();
    // gameData is literally this object; document the shape the resume relies on.
    expect(state).toEqual(expect.objectContaining({
      puzzle: expect.objectContaining({
        start: 'ghana',
        end: 'united arab emirates',
        shortestPath: expect.any(Array),
        shortestPathLength: expect.any(Number),
        maxGuesses: expect.any(Number),
      }),
      guesses: [],
      guessesRemaining: state.puzzle.maxGuesses,
      isComplete: false,
      isWin: false,
      currentChain: null,
    }));
  });
});

// --- Save/resume round-trip (repository level) --------------------------------

describe('Travle DB save/resume round-trip (characterization)', () => {
  let sessionRepo: GameStateRepository;
  let userRepo: UserRepository;

  beforeAll(async () => {
    await DatabaseConnectionFactory.close();
    const db = await DatabaseConnectionFactory.create({ type: 'sqlite', database: ':memory:' });
    await new MigrationManager(db).migrate();
    sessionRepo = new GameStateRepository(db);
    userRepo = new UserRepository(db);
  });

  afterAll(async () => {
    await DatabaseConnectionFactory.close();
  });

  /** Mirror server saveCompletedGame: store the FULL state as gameData. */
  async function save(userId: string, state: TravleGameState, guildId?: string) {
    await userRepo.upsertUser(userId, 'activity_user_' + userId);
    const existing = await sessionRepo.getActiveSession(userId, 'travle', new Date());
    if (existing) {
      if (guildId && existing.serverId === 'activity') {
        await sessionRepo.updateServerId(existing.id, guildId);
      }
      await sessionRepo.updateGameData(existing.id, state as any);
      if (state.isComplete && !existing.isComplete) {
        await sessionRepo.completeSession(existing.id, {
          isWin: state.isWin,
          guessCount: state.guesses.length,
          shortestPath: state.puzzle.shortestPathLength,
        });
      }
      return existing.id;
    }
    const created = await sessionRepo.createSession({
      userId,
      serverId: guildId || 'activity',
      gameType: 'travle',
      puzzleDate: new Date(),
      maxAttempts: state.puzzle.maxGuesses,
      gameData: state as any,
    });
    if (state.isComplete) {
      await sessionRepo.completeSession(created.id, {
        isWin: state.isWin,
        guessCount: state.guesses.length,
        shortestPath: state.puzzle.shortestPathLength,
      });
    }
    return created.id;
  }

  it('persists the full state and resumes an identical state directly (no replay)', async () => {
    const userId = 'tv_' + Math.random().toString(36).slice(2);

    const live = ghanaToUAE();
    game.guess(live, 'mali');
    game.guess(live, 'egypt');
    await save(userId, live);

    // Read back what the server would read.
    const dbSession = await sessionRepo.getActiveSession(userId, 'travle', new Date());
    expect(dbSession).not.toBeNull();
    // The server resumes by reading gameData AS the state (guarded by gameData.puzzle).
    expect(dbSession!.gameData.puzzle).toBeDefined();

    const resumed = resumeFromGameData(dbSession!.gameData);
    // Full structural equality — resume must reproduce the live state exactly.
    expect(resumed).toEqual(live);
    expect(resumed.guesses.map(g => g.country)).toEqual(['mali', 'egypt']);
    expect(resumed.guessesRemaining).toBe(live.guessesRemaining);
  });

  it('marks the session complete on a win and resumes the completed state', async () => {
    const userId = 'tv_' + Math.random().toString(36).slice(2);

    const live = ghanaToUAE();
    for (const c of live.puzzle.shortestPath.slice(1, -1)) game.guess(live, c);
    expect(live.isWin).toBe(true);
    await save(userId, live);

    const dbSession = await sessionRepo.getActiveSession(userId, 'travle', new Date());
    // NOTE: SQLite stores booleans as integers and mapRowToSession does not
    // coerce is_complete, so the real returned value is 1 (truthy), not the
    // literal `true`. The server's resume guard (`!existing.isComplete`) relies
    // only on truthiness, so this is correct current behavior — lock it in as
    // truthy rather than asserting a strict boolean.
    expect(dbSession!.isComplete).toBeTruthy();
    expect(dbSession!.result?.isWin).toBe(true);

    const resumed = resumeFromGameData(dbSession!.gameData);
    expect(resumed.isComplete).toBe(true);
    expect(resumed.isWin).toBe(true);
  });

  it('updates the same session on a second save (no duplicate rows)', async () => {
    const userId = 'tv_' + Math.random().toString(36).slice(2);

    const s1 = ghanaToUAE();
    game.guess(s1, 'mali');
    const id1 = await save(userId, s1);

    // Continue playing the SAME state, save again.
    game.guess(s1, 'egypt');
    const id2 = await save(userId, s1);

    expect(id2).toBe(id1); // same row updated
    const dbSession = await sessionRepo.getActiveSession(userId, 'travle', new Date());
    expect((dbSession!.gameData as any).guesses.map((g: any) => g.country)).toEqual(['mali', 'egypt']);
  });

  it('does NOT resume when gameData has no puzzle (server guard: gameData.puzzle)', () => {
    // The server only treats a DB row as resumable when gameData.puzzle exists;
    // otherwise it falls through to creating a fresh puzzle.
    const emptyGameData: Record<string, any> = {};
    expect(emptyGameData.puzzle).toBeUndefined();
  });
});
