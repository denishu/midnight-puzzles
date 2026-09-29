// Characterization tests — lock in the CURRENT Duotrigordle web-session
// save/resume/replay behavior before migrating it onto SessionManager.
//
// These reproduce, in isolation, exactly what web/duotrigordle/server.ts does
// today: it stores a guess-word list in gameData and, on a cache miss,
// reconstructs grid state by replaying those words through a fresh GridManager.
// The refactor must preserve every property asserted here.

import { WordValidator } from '../../../games/duotrigordle/WordValidator';
import { GridManager, MAX_GUESSES, DuotrigordlePuzzle } from '../../../games/duotrigordle/GridManager';
import { ProgressTracker } from '../../../games/duotrigordle/ProgressTracker';
import { GameStateRepository } from '../../../core/storage/GameStateRepository';
import { UserRepository } from '../../../core/storage/UserRepository';
import { DatabaseConnectionFactory } from '../../../core/storage/DatabaseConnection';
import { MigrationManager } from '../../../core/storage/migrations/migrate';

// --- Test fixtures ------------------------------------------------------------

/** 40 unique deterministic 5-letter "words" (32 targets + spare guesses). */
function generateWords(): string[] {
  const words: string[] = [];
  for (let i = 0; i < 40; i++) {
    const c1 = String.fromCharCode(97 + Math.floor(i / 26));
    const c2 = String.fromCharCode(97 + (i % 26));
    words.push('aaa' + c1 + c2);
  }
  return words;
}

const WORDS = generateWords();

function makeValidator(): WordValidator {
  const v = new WordValidator();
  // All 40 are valid answers/guesses so applyGuess accepts them.
  v.loadFromArrays(WORDS, []);
  return v;
}

/** Build a fresh session (mirrors server getSession's construction step). */
function freshSession(validator: WordValidator, puzzle: DuotrigordlePuzzle) {
  const gm = new GridManager(validator);
  gm.initializeGrids(puzzle);
  const tracker = new ProgressTracker(gm);
  return { gridManager: gm, tracker, puzzle, givenUp: false as boolean };
}

/** The exact reconstruction the server performs from stored gameData. */
function replayFromGameData(
  validator: WordValidator,
  puzzle: DuotrigordlePuzzle,
  gameData: { guesses?: unknown; gaveUp?: boolean },
  result?: { gaveUp?: boolean }
) {
  const session = freshSession(validator, puzzle);
  if (gameData?.guesses && Array.isArray(gameData.guesses)) {
    for (const word of gameData.guesses) {
      session.gridManager.applyGuess(word as string);
    }
    if (result?.gaveUp || gameData?.gaveUp) {
      session.givenUp = true;
    }
  }
  return session;
}

// --- Replay determinism (game-logic level, survives the refactor) -------------

describe('Duotrigordle replay determinism (characterization)', () => {
  const validator = makeValidator();
  // Fixed puzzle: first 32 words are the targets.
  const puzzle: DuotrigordlePuzzle = { date: '2026-01-01', targetWords: WORDS.slice(0, 32) };

  it('replaying the same guess list reproduces identical grid state', () => {
    const guesses = [WORDS[0]!, WORDS[5]!, WORDS[10]!, WORDS[31]!];

    // "Live" session that played the guesses directly.
    const live = freshSession(validator, puzzle);
    for (const w of guesses) live.gridManager.applyGuess(w);

    // "Resumed" session reconstructed by replaying stored guesses.
    const resumed = replayFromGameData(validator, puzzle, { guesses });

    const liveSummary = live.tracker.getSummary();
    const resumedSummary = resumed.tracker.getSummary();

    expect(resumedSummary.guessesUsed).toBe(liveSummary.guessesUsed);
    expect(resumedSummary.completedGrids).toBe(liveSummary.completedGrids);
    expect(resumedSummary.isGameOver).toBe(liveSummary.isGameOver);
    expect(resumedSummary.isWin).toBe(liveSummary.isWin);

    // Grid-by-grid guess history must match exactly.
    const liveGrids = live.gridManager.getGrids();
    const resumedGrids = resumed.gridManager.getGrids();
    expect(resumedGrids.length).toBe(liveGrids.length);
    for (let i = 0; i < liveGrids.length; i++) {
      expect(resumedGrids[i]!.guesses.map(g => g.word))
        .toEqual(liveGrids[i]!.guesses.map(g => g.word));
      expect(resumedGrids[i]!.isComplete).toBe(liveGrids[i]!.isComplete);
    }
  });

  it('guessing all 32 targets wins, and replay reproduces the win', () => {
    const targets = WORDS.slice(0, 32);
    const live = freshSession(validator, puzzle);
    for (const w of targets) live.gridManager.applyGuess(w);
    expect(live.tracker.getSummary().isWin).toBe(true);

    const resumed = replayFromGameData(validator, puzzle, { guesses: targets });
    expect(resumed.tracker.getSummary().isWin).toBe(true);
    expect(resumed.tracker.getSummary().completedGrids).toBe(32);
  });

  it('marks givenUp from gameData.gaveUp OR result.gaveUp', () => {
    const guesses = [WORDS[0]!];
    expect(replayFromGameData(validator, puzzle, { guesses, gaveUp: true }).givenUp).toBe(true);
    expect(replayFromGameData(validator, puzzle, { guesses }, { gaveUp: true }).givenUp).toBe(true);
    expect(replayFromGameData(validator, puzzle, { guesses }).givenUp).toBe(false);
  });

  it('empty / missing guess list yields a pristine board', () => {
    const resumed = replayFromGameData(validator, puzzle, {});
    expect(resumed.tracker.getSummary().guessesUsed).toBe(0);
    expect(resumed.tracker.getSummary().completedGrids).toBe(0);
  });
});

// --- Save/resume round-trip (repository level) --------------------------------

describe('Duotrigordle DB save/resume round-trip (characterization)', () => {
  let sessionRepo: GameStateRepository;
  let userRepo: UserRepository;
  const validator = makeValidator();
  const puzzle: DuotrigordlePuzzle = { date: '2026-01-01', targetWords: WORDS.slice(0, 32) };

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

  /** Mirror server saveGameState: store the guess-word list + counters. */
  async function save(userId: string, session: ReturnType<typeof freshSession>, guildId?: string) {
    await userRepo.upsertUser(userId, 'activity_user_' + userId);
    const summary = session.tracker.getSummary();
    const guesses = session.gridManager.getGrids()[0]?.guesses.map(g => g.word) ?? [];
    const existing = await sessionRepo.getActiveSession(userId, 'duotrigordle', new Date());
    const gameData = {
      guesses,
      gridsCompleted: summary.completedGrids,
      guessesUsed: summary.guessesUsed,
      gaveUp: !!session.givenUp,
    };
    if (existing) {
      await sessionRepo.updateGameData(existing.id, gameData);
      return existing.id;
    }
    const created = await sessionRepo.createSession({
      userId,
      serverId: guildId || 'activity',
      gameType: 'duotrigordle',
      puzzleDate: new Date(),
      maxAttempts: MAX_GUESSES,
      gameData,
    });
    return created.id;
  }

  it('persists the guess list and resumes identical state from the DB', async () => {
    const userId = 'dt_' + Math.random().toString(36).slice(2);
    const guesses = [WORDS[0]!, WORDS[7]!, WORDS[15]!];

    // Play + save.
    const live = freshSession(validator, puzzle);
    for (const w of guesses) live.gridManager.applyGuess(w);
    await save(userId, live);

    // Read back what the server would read.
    const dbSession = await sessionRepo.getActiveSession(userId, 'duotrigordle', new Date());
    expect(dbSession).not.toBeNull();
    expect(dbSession!.gameData.guesses).toEqual(guesses);

    // Resume by replay and compare to the live session.
    const resumed = replayFromGameData(validator, puzzle, dbSession!.gameData as any);
    expect(resumed.tracker.getSummary().guessesUsed).toBe(live.tracker.getSummary().guessesUsed);
    expect(resumed.tracker.getSummary().completedGrids).toBe(live.tracker.getSummary().completedGrids);
    expect(
      resumed.gridManager.getGrids()[0]!.guesses.map(g => g.word)
    ).toEqual(live.gridManager.getGrids()[0]!.guesses.map(g => g.word));
  });

  it('updates the same session on a second save (no duplicate rows)', async () => {
    const userId = 'dt_' + Math.random().toString(36).slice(2);

    const s1 = freshSession(validator, puzzle);
    s1.gridManager.applyGuess(WORDS[0]!);
    const id1 = await save(userId, s1);

    const s2 = freshSession(validator, puzzle);
    s2.gridManager.applyGuess(WORDS[0]!);
    s2.gridManager.applyGuess(WORDS[1]!);
    const id2 = await save(userId, s2);

    expect(id2).toBe(id1); // same row updated
    const dbSession = await sessionRepo.getActiveSession(userId, 'duotrigordle', new Date());
    expect(dbSession!.gameData.guesses).toEqual([WORDS[0]!, WORDS[1]!]);
  });
});
