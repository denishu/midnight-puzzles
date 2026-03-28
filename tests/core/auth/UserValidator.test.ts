import { UserValidator } from '../../../core/auth/UserValidator';
import { UserRepository } from '../../../core/storage/UserRepository';

describe('UserValidator', () => {
  let userValidator: UserValidator;
  let mockUserRepo: jest.Mocked<UserRepository>;

  beforeEach(() => {
    mockUserRepo = {
      upsertUser: jest.fn(),
      updateLastActive: jest.fn(),
    } as any;

    userValidator = new UserValidator(mockUserRepo);
  });

  afterEach(() => {
    // Clean up resources to prevent worker process issues
    userValidator.destroy();
    jest.clearAllTimers();
  });

  describe('validateUser', () => {
    it('should validate and register user', async () => {
      mockUserRepo.upsertUser.mockResolvedValue({} as any);
      mockUserRepo.updateLastActive.mockResolvedValue();

      const result = await userValidator.validateUser('user-123', 'TestUser');

      expect(result).toBe(true);
      expect(mockUserRepo.upsertUser).toHaveBeenCalledWith('user-123', 'TestUser');
      expect(mockUserRepo.updateLastActive).toHaveBeenCalledWith('user-123');
    });
  });

  describe('checkRateLimit', () => {
    it('should allow requests within rate limit', () => {
      const result1 = userValidator.checkRateLimit('user-1');
      const result2 = userValidator.checkRateLimit('user-1');

      expect(result1).toBe(true);
      expect(result2).toBe(true);
    });

    it('should block requests exceeding rate limit', () => {
      const config = { maxRequests: 3, windowMs: 60000 };

      // Make 3 requests (should all succeed)
      expect(userValidator.checkRateLimit('user-2', config)).toBe(true);
      expect(userValidator.checkRateLimit('user-2', config)).toBe(true);
      expect(userValidator.checkRateLimit('user-2', config)).toBe(true);

      // 4th request should be blocked
      expect(userValidator.checkRateLimit('user-2', config)).toBe(false);
    });

    it('should track rate limits per user independently', () => {
      const config = { maxRequests: 2, windowMs: 60000 };

      expect(userValidator.checkRateLimit('user-3', config)).toBe(true);
      expect(userValidator.checkRateLimit('user-3', config)).toBe(true);
      expect(userValidator.checkRateLimit('user-3', config)).toBe(false);

      // Different user should have separate limit
      expect(userValidator.checkRateLimit('user-4', config)).toBe(true);
      expect(userValidator.checkRateLimit('user-4', config)).toBe(true);
    });
  });

  describe('getRemainingRequests', () => {
    it('should return correct remaining request count', () => {
      const config = { maxRequests: 5, windowMs: 60000 };

      expect(userValidator.getRemainingRequests('user-5', config)).toBe(5);

      userValidator.checkRateLimit('user-5', config);
      expect(userValidator.getRemainingRequests('user-5', config)).toBe(4);

      userValidator.checkRateLimit('user-5', config);
      expect(userValidator.getRemainingRequests('user-5', config)).toBe(3);
    });
  });

  describe('canStartGame', () => {
    it('should allow game start when validation passes and within rate limit', async () => {
      mockUserRepo.upsertUser.mockResolvedValue({} as any);
      mockUserRepo.updateLastActive.mockResolvedValue();

      const result = await userValidator.canStartGame('user-6', 'TestUser');

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should block game start when rate limited', async () => {
      mockUserRepo.upsertUser.mockResolvedValue({} as any);
      mockUserRepo.updateLastActive.mockResolvedValue();

      const config = { maxRequests: 1, windowMs: 60000 };
      userValidator.setDefaultRateLimit(config);

      // First request should succeed
      await userValidator.canStartGame('user-7', 'TestUser');

      // Second request should be blocked
      const result = await userValidator.canStartGame('user-7', 'TestUser');

      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Rate limit exceeded');
    });
  });

  describe('resetRateLimit', () => {
    it('should reset rate limit for a user', () => {
      const config = { maxRequests: 2, windowMs: 60000 };

      userValidator.checkRateLimit('user-8', config);
      userValidator.checkRateLimit('user-8', config);
      expect(userValidator.checkRateLimit('user-8', config)).toBe(false);

      userValidator.resetRateLimit('user-8');
      expect(userValidator.checkRateLimit('user-8', config)).toBe(true);
    });
  });
});
