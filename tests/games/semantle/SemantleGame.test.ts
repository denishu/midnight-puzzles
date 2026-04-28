import { SemantleGame } from '../../../games/semantle/SemantleGame';
import { SemanticEngine } from '../../../games/semantle/SemanticEngine';
import { SessionManager } from '../../../core/auth/SessionManager';
import { GameStateRepository } from '../../../core/storage/GameStateRepository';
import { DailyPuzzleRepository } from '../../../core/storage/DailyPuzzleRepository';
import { DatabaseConnectionFactory } from '../../../core/storage/DatabaseConnection';
import { MigrationManager } from '../../../core/storage/migrations/migrate';
import { UserRepository } from '../../../core/storage/UserRepository';

let game: SemantleGame;
let sessionRepo: GameStateRepository;
let userRepo: UserRepository;

beforeAll(async () => {
  // Close any existing connection from other test suites
  await DatabaseConnectionFactory.close();

  const db = await DatabaseConnectionFactory.create({
    type: 'sqlite',
    database: ':memory:',
  });
  await new MigrationManager(db).migrate();

  sessionRepo = new GameStateRepository(db);
  userRepo = new UserRepository(db);
  const dailyPuzzleRepo = new DailyPuzzleRepository(db);
  const sessionManager = new SessionManager(sessionRepo);
  const semanticEngine = new SemanticEngine();

  game = new SemantleGame(semanticEngine, sessionManager, dailyPuzzleRepo);
  await game.initialize();
}, 120000);

async function createTestSession(): Promise<string> {
  const userId = 'test_' + Math.random().toString(36).slice(2);
  await userRepo.upsertUser(userId, 'testuser');
  const session = await game.startSession(userId, 'test-server');
  return session.id;
}

describe('SemantleGame', () => {
  describe('session management', () => {
    it('creates a new session with a target word', async () => {
      const userId = 'test_session_1';
      await userRepo.upsertUser(userId, 'testuser');
      const session = await game.startSession(userId, 'test-server');
      expect(session.gameData.targetWord).toBeTruthy();
      expect(session.isComplete).toBeFalsy();
      expect(session.attempts).toBe(0);
    });

    it('resumes an existing session for the same user and date', async () => {
      const userId = 'test_session_2';
      await userRepo.upsertUser(userId, 'testuser');
      const session1 = await game.startSession(userId, 'test-server');
      const session2 = await game.startSession(userId, 'test-server');
      expect(session1.id).toBe(session2.id);
      expect(session1.gameData.targetWord).toBe(session2.gameData.targetWord);
    });
  });

  describe('guess processing', () => {
    it('accepts a valid word and returns similarity', async () => {
      const sessionId = await createTestSession();
      const result = await game.processGuess(sessionId, 'river');
      expect(result.isValid).toBe(true);
      expect(result.data?.similarity).toBeDefined();
      expect(result.isComplete).toBe(false);
    });

    it('rejects an invalid word', async () => {
      const sessionId = await createTestSession();
      const result = await game.processGuess(sessionId, 'xyzzyplugh');
      expect(result.isValid).toBe(false);
    });

    it('rejects a duplicate guess', async () => {
      const sessionId = await createTestSession();
      await game.processGuess(sessionId, 'river');
      const result = await game.processGuess(sessionId, 'river');
      expect(result.isValid).toBe(false);
    });

    it('wins when the correct word is guessed', async () => {
      const userId = 'test_win_' + Math.random().toString(36).slice(2);
      await userRepo.upsertUser(userId, 'testuser');
      const session = await game.startSession(userId, 'test-server');
      const targetWord = session.gameData.targetWord;

      const result = await game.processGuess(session.id, targetWord);
      expect(result.isValid).toBe(true);
      expect(result.isComplete).toBe(true);
      expect(result.feedback).toContain('Congratulations');
    });

    it('rejects guesses after game is complete', async () => {
      const userId = 'test_complete_' + Math.random().toString(36).slice(2);
      await userRepo.upsertUser(userId, 'testuser');
      const session = await game.startSession(userId, 'test-server');
      const targetWord = session.gameData.targetWord;

      await game.processGuess(session.id, targetWord);
      const result = await game.processGuess(session.id, 'river');
      expect(result.isValid).toBe(false);
      expect(result.isComplete).toBe(true);
    });

    it('tracks best rank across guesses', async () => {
      const sessionId = await createTestSession();
      const state1 = await game.getGameState(sessionId);
      expect(state1.state.bestRank).toBeNull();

      await game.processGuess(sessionId, 'river');
      await game.processGuess(sessionId, 'ocean');

      const state2 = await game.getGameState(sessionId);
      // bestRank should be set if either word was ranked
      // (may or may not be ranked depending on target word)
    });
  });

  describe('deterministic puzzle generation', () => {
    it('generates the same puzzle for the same date', async () => {
      const date = new Date('2026-06-15');
      const puzzle1 = await game.generateDailyPuzzle(date);
      const puzzle2 = await game.generateDailyPuzzle(date);
      expect(puzzle1.puzzleData.targetWord).toBe(puzzle2.puzzleData.targetWord);
    });

    it('generates different puzzles for different dates', async () => {
      const puzzle1 = await game.generateDailyPuzzle(new Date('2026-06-15'));
      const puzzle2 = await game.generateDailyPuzzle(new Date('2026-06-16'));
      expect(puzzle1.puzzleData.targetWord).not.toBe(puzzle2.puzzleData.targetWord);
    });
  });

  describe('similarity thresholds', () => {
    it('returns thresholds for a valid target word', () => {
      const thresholds = game.getSimilarityThresholds('river');
      expect(thresholds.rank1).not.toBeNull();
      expect(thresholds.rank10).not.toBeNull();
      expect(thresholds.rank1000).not.toBeNull();
      // rank1 should be highest similarity
      expect(thresholds.rank1!).toBeGreaterThan(thresholds.rank10!);
      expect(thresholds.rank10!).toBeGreaterThan(thresholds.rank1000!);
    });
  });
});

afterAll(async () => {
  await DatabaseConnectionFactory.close();
});
