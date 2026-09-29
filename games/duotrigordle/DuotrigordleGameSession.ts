import { SessionManager } from '../../core/auth/SessionManager';
import { GameSession } from '../../core/auth/Game.interface';
import { GridManager, MAX_GUESSES, DuotrigordlePuzzle, GuessApplicationResult } from './GridManager';
import { WordValidator } from './WordValidator';
import { ProgressTracker } from './ProgressTracker';
import { Logger } from '../../core/utils/Logger';

/** A reconstructed live Duotrigordle session (not persisted directly). */
export interface DuotrigordleLiveSession {
  gridManager: GridManager;
  tracker: ProgressTracker;
  puzzle: DuotrigordlePuzzle;
  givenUp: boolean;
}

/**
 * Integrates Duotrigordle with the shared {@link SessionManager}.
 *
 * Mirrors the SemantleGame / TravleGameSession pattern: this wrapper owns the
 * SessionManager and the web server keeps only a `userId -> sessionId` map.
 *
 * The key difference from Travle: Duotrigordle does NOT store its full live
 * state. It persists only the guess-word list (+ counters) in `gameData`, and
 * reconstructs the 32 live grids by REPLAYING those guesses through a fresh
 * GridManager. That replay is this wrapper's "deserialize" step. This preserves
 * the behavior locked in by
 * tests/games/duotrigordle/WebSessionResume.characterization.test.ts.
 */
export class DuotrigordleGameSession {
  readonly name = 'duotrigordle';

  private validator: WordValidator;
  private sessionManager: SessionManager;
  private logger: Logger;

  constructor(validator: WordValidator, sessionManager: SessionManager) {
    this.validator = validator;
    this.sessionManager = sessionManager;
    this.logger = new Logger('DuotrigordleGameSession');
  }

  /** Build today's puzzle. */
  private todayPuzzle(): DuotrigordlePuzzle {
    return GridManager.generateDailyPuzzle(new Date(), this.validator);
  }

  /** Construct a fresh live session for a puzzle. */
  private freshLive(puzzle: DuotrigordlePuzzle): DuotrigordleLiveSession {
    const gm = new GridManager(this.validator);
    gm.initializeGrids(puzzle);
    const tracker = new ProgressTracker(gm);
    return { gridManager: gm, tracker, puzzle, givenUp: false };
  }

  /**
   * Deserialize step: rebuild the live grid state by replaying the stored
   * guess-word list through a fresh GridManager. Mirrors exactly what the
   * server's getSession did inline.
   */
  private replay(puzzle: DuotrigordlePuzzle, gameData: Record<string, any>, result?: Record<string, any>): DuotrigordleLiveSession {
    const live = this.freshLive(puzzle);
    if (gameData?.guesses && Array.isArray(gameData.guesses)) {
      for (const word of gameData.guesses) {
        live.gridManager.applyGuess(word as string);
      }
      if (result?.gaveUp || gameData?.gaveUp) {
        live.givenUp = true;
      }
    }
    return live;
  }

  /** Serialize step: the guess-word list + counters the server stores. */
  private serialize(live: DuotrigordleLiveSession): Record<string, any> {
    const summary = live.tracker.getSummary();
    const guesses = live.gridManager.getGrids()[0]?.guesses.map(g => g.word) ?? [];
    return {
      guesses,
      gridsCompleted: summary.completedGrids,
      guessesUsed: summary.guessesUsed,
      gaveUp: !!live.givenUp,
    };
  }

  /**
   * Get or create today's session for a user (handles DB resumption) and
   * return the reconstructed live session. Mirrors Semantle/Travle: the DB
   * session is created/resumed via SessionManager; the live grids are rebuilt
   * by replay.
   */
  async startSession(userId: string, serverId: string): Promise<{ session: GameSession; live: DuotrigordleLiveSession }> {
    const puzzle = this.todayPuzzle();
    const session = await this.sessionManager.getOrCreateSession(
      userId,
      serverId,
      this.name,
      MAX_GUESSES,
    );

    // New session: initialize empty gameData.
    if (!session.gameData || Object.keys(session.gameData).length === 0) {
      const live = this.freshLive(puzzle);
      session.gameData = this.serialize(live);
      await this.sessionManager.updateSession(session.id, session.gameData);
      return { session, live };
    }

    // Existing session: rebuild live grids by replay.
    const live = this.replay(puzzle, session.gameData, session.result ?? undefined);
    return { session, live };
  }

  /** Reconstruct the live session for an existing sessionId (replay). */
  async getLive(sessionId: string): Promise<DuotrigordleLiveSession | null> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) return null;
    const puzzle = this.todayPuzzle();
    if (!session.gameData || Object.keys(session.gameData).length === 0) {
      return this.freshLive(puzzle);
    }
    return this.replay(puzzle, session.gameData, session.result ?? undefined);
  }

  /**
   * Apply a guess: replay to current state, apply the new guess, persist the
   * updated guess list, and complete the DB session on game over.
   */
  async processGuess(sessionId: string, word: string): Promise<{ result: GuessApplicationResult; live: DuotrigordleLiveSession } | null> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) return null;

    const puzzle = this.todayPuzzle();
    const live = this.replay(puzzle, session.gameData ?? {}, session.result ?? undefined);

    if (live.givenUp) {
      return { result: live.gridManager.applyGuess(word), live }; // will report game-over error
    }

    const result = live.gridManager.applyGuess(word);
    if (!result.isValid) {
      return { result, live };
    }

    await this.persist(sessionId, session, live);
    return { result, live };
  }

  /** Mark the session as given up and persist as a completed loss. */
  async giveUp(sessionId: string): Promise<DuotrigordleLiveSession | null> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) return null;
    const puzzle = this.todayPuzzle();
    const live = this.replay(puzzle, session.gameData ?? {}, session.result ?? undefined);
    live.givenUp = true;
    await this.persist(sessionId, session, live);
    return live;
  }

  /** Persist the current live state (guess list + counters) and complete on game over. */
  private async persist(sessionId: string, session: GameSession, live: DuotrigordleLiveSession): Promise<void> {
    const summary = live.tracker.getSummary();
    await this.sessionManager.updateSession(sessionId, this.serialize(live));
    if ((summary.isGameOver || live.givenUp) && !session.isComplete) {
      await this.sessionManager.completeSession(sessionId, {
        isWin: summary.isWin,
        gridsCompleted: summary.completedGrids,
        guessesUsed: summary.guessesUsed,
        gaveUp: !!live.givenUp,
      });
    }
  }

  /** Fix server_id once the real guild id is known (was 'activity'). */
  async fixServerId(sessionId: string, guildId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId);
    if (session && session.serverId === 'activity') {
      await this.sessionManager.updateServerId(sessionId, guildId);
    }
  }

  // --- Anonymous / local play (never persisted) ------------------------------

  /** Build a fresh, unpersisted live session for anonymous users. */
  newAnonLive(): DuotrigordleLiveSession {
    return this.freshLive(this.todayPuzzle());
  }
}
