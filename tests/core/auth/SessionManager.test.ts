import { SessionManager } from '../../../core/auth/SessionManager';
import { GameStateRepository } from '../../../core/storage/GameStateRepository';
import { DatabaseConnection } from '../../../core/storage/DatabaseConnection';

describe('SessionManager', () => {
  let sessionManager: SessionManager;
  let mockGameStateRepo: jest.Mocked<GameStateRepository>;

  beforeEach(() => {
    // Create mock repository
    mockGameStateRepo = {
      getActiveSession: jest.fn(),
      createSession: jest.fn(),
      getSession: jest.fn(),
      updateGameData: jest.fn(),
      incrementAttempts: jest.fn(),
      completeSession: jest.fn(),
      hasCompletedToday: jest.fn(),
    } as any;

    sessionManager = new SessionManager(mockGameStateRepo);
  });

  describe('getOrCreateSession', () => {
    it('should resume existing session when available', async () => {
      const existingSession = {
        id: 'session-123',
        userId: 'user-1',
        serverId: 'server-1',
        gameType: 'semantle',
        puzzleDate: new Date('2024-01-01'),
        startTime: new Date(),
        endTime: null,
        isComplete: false,
        attempts: 5,
        maxAttempts: 100,
        gameData: { guesses: [] },
        result: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockGameStateRepo.getActiveSession.mockResolvedValue(existingSession);

      const result = await sessionManager.getOrCreateSession(
        'user-1',
        'server-1',
        'semantle',
        100
      );

      expect(result).toEqual(existingSession);
      expect(mockGameStateRepo.getActiveSession).toHaveBeenCalledWith(
        'user-1',
        'semantle',
        expect.any(Date)
      );
      expect(mockGameStateRepo.createSession).not.toHaveBeenCalled();
    });

    it('should create new session when none exists', async () => {
      const newSession = {
        id: 'session-456',
        userId: 'user-2',
        serverId: 'server-1',
        gameType: 'travle',
        puzzleDate: new Date('2024-01-01'),
        startTime: new Date(),
        endTime: null,
        isComplete: false,
        attempts: 0,
        maxAttempts: 10,
        gameData: {},
        result: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockGameStateRepo.getActiveSession.mockResolvedValue(null);
      mockGameStateRepo.createSession.mockResolvedValue(newSession);

      const result = await sessionManager.getOrCreateSession(
        'user-2',
        'server-1',
        'travle',
        10
      );

      expect(result).toEqual(newSession);
      expect(mockGameStateRepo.createSession).toHaveBeenCalled();
    });
  });

  describe('completeSession', () => {
    it('should mark session as complete', async () => {
      const session = {
        id: 'session-789',
        userId: 'user-3',
        serverId: 'server-1',
        gameType: 'duotrigordle',
        puzzleDate: new Date(),
        startTime: new Date(),
        endTime: null,
        isComplete: false,
        attempts: 20,
        maxAttempts: 37,
        gameData: {},
        result: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockGameStateRepo.getActiveSession.mockResolvedValue(session);
      await sessionManager.getOrCreateSession('user-3', 'server-1', 'duotrigordle', 37);

      const result = { success: true, attempts: 20 };
      await sessionManager.completeSession('session-789', result);

      expect(mockGameStateRepo.completeSession).toHaveBeenCalledWith('session-789', result);
    });
  });

  describe('hasCompletedToday', () => {
    it('should check if user completed today\'s puzzle', async () => {
      mockGameStateRepo.hasCompletedToday.mockResolvedValue(true);

      const result = await sessionManager.hasCompletedToday('user-1', 'semantle');

      expect(result).toBe(true);
      expect(mockGameStateRepo.hasCompletedToday).toHaveBeenCalledWith('user-1', 'semantle');
    });
  });

  describe('cleanupOldSessions', () => {
    it('should remove completed sessions older than specified time', async () => {
      const oldSession = {
        id: 'old-session',
        userId: 'user-1',
        serverId: 'server-1',
        gameType: 'semantle',
        puzzleDate: new Date(),
        startTime: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
        endTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
        isComplete: true,
        attempts: 10,
        maxAttempts: 100,
        gameData: {},
        result: { success: true },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockGameStateRepo.getActiveSession.mockResolvedValue(oldSession);
      await sessionManager.getOrCreateSession('user-1', 'server-1', 'semantle', 100);

      const removed = sessionManager.cleanupOldSessions(60); // 60 minutes

      expect(removed).toBe(1);
    });
  });
});
