import { SessionManager } from '../../core/auth/SessionManager';
import { GameSession } from '../../core/auth/Game.interface';
import { CountryGraph } from './CountryGraph';
import { TravleGame, TravleGameState, TravleGuessResult } from './TravleGame';
import { Logger } from '../../core/utils/Logger';

/**
 * Integrates {@link TravleGame} with the shared {@link SessionManager}.
 *
 * Mirrors the SemantleGame pattern: this wrapper owns the SessionManager and
 * stores the full game state as plain data in `session.gameData`. The web
 * server keeps only a `userId -> sessionId` map and delegates here, instead of
 * hand-rolling its own in-memory session map + DB resume/save logic.
 *
 * Travle's serialized form IS its live state ({@link TravleGameState}), so
 * "resume" is a direct read of `gameData` — no replay step (unlike
 * Duotrigordle). This preserves the behavior locked in by
 * tests/games/travle/WebSessionResume.characterization.test.ts.
 */
export class TravleGameSession {
  readonly name = 'travle';

  private graph: CountryGraph;
  private game: TravleGame;
  private sessionManager: SessionManager;
  private logger: Logger;
  private initialized = false;

  constructor(graph: CountryGraph, sessionManager: SessionManager) {
    this.graph = graph;
    this.game = new TravleGame(graph);
    this.sessionManager = sessionManager;
    this.logger = new Logger('TravleGameSession');
  }

  /** Initialize the underlying game (puzzle generator). Graph must already be initialized. */
  init(): void {
    if (this.initialized) return;
    this.game.init();
    this.initialized = true;
    this.logger.info('Travle game session manager initialized');
  }

  /** Expose the graph for read-only endpoints (e.g. hints). */
  getGraph(): CountryGraph {
    return this.graph;
  }

  /**
   * Get or create today's session for a user (handles DB resumption).
   * If new, initializes `gameData` with a fresh TravleGameState for today's puzzle.
   * Returns the session id (mirrors Semantle's server contract).
   */
  async startSession(userId: string, serverId: string): Promise<GameSession> {
    const puzzle = this.game.genPuzzle(new Date());
    const session = await this.sessionManager.getOrCreateSession(
      userId,
      serverId,
      this.name,
      puzzle.maxGuesses,
    );

    // Initialize game data for a brand-new session (no stored puzzle yet).
    if (!session.gameData || !session.gameData.puzzle) {
      const fresh = this.game.newState(puzzle);
      session.gameData = fresh as unknown as Record<string, any>;
      await this.sessionManager.updateSession(session.id, session.gameData);
    }

    return session;
  }

  /**
   * Process a guess against the stored state, persist it, and complete on game over.
   * Mirrors what web/travle/server.ts did inline: guess() mutates the state,
   * then the whole state is saved back to gameData.
   */
  async processGuess(sessionId: string, country: string): Promise<TravleGuessResult> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session) {
      return { isValid: false, feedback: 'Session not found', isGameOver: false, isWin: false, status: 'invalid' };
    }

    const state = session.gameData as unknown as TravleGameState;
    const result = this.game.guess(state, country);

    // Persist the mutated state on every guess (enables cross-context resume).
    session.gameData = state as unknown as Record<string, any>;
    await this.sessionManager.updateSession(sessionId, session.gameData);

    // Mark the DB session complete on game over (same result shape as before).
    if (state.isComplete && !session.isComplete) {
      await this.sessionManager.completeSession(sessionId, {
        isWin: state.isWin,
        guessCount: state.guesses.length,
        shortestPath: state.puzzle.shortestPathLength,
      });
    }

    return result;
  }

  /** Get the current stored TravleGameState for a session. */
  async getState(sessionId: string): Promise<TravleGameState | null> {
    const session = await this.sessionManager.getSession(sessionId);
    if (!session || !session.gameData || !session.gameData.puzzle) return null;
    return session.gameData as unknown as TravleGameState;
  }

  /**
   * Fix a session's server_id once the real guild id is known (sessions created
   * from a DM/unknown context start as 'activity'). No-op if already set.
   */
  async fixServerId(sessionId: string, guildId: string): Promise<void> {
    const session = await this.sessionManager.getSession(sessionId);
    if (session && session.serverId === 'activity') {
      await this.sessionManager.updateServerId(sessionId, guildId);
    }
  }

  // --- Anonymous / local play (never persisted) ------------------------------

  /** Build a fresh, unpersisted state for today's puzzle (anonymous users). */
  newAnonState(date: Date): TravleGameState {
    return this.game.newState(this.game.genPuzzle(date));
  }

  /** Apply a guess to an ephemeral anonymous state (mutates in place). */
  guessAnon(state: TravleGameState, country: string): TravleGuessResult {
    return this.game.guess(state, country);
  }
}
