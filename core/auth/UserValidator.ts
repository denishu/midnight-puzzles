import { UserRepository } from '../storage/UserRepository';
import { Logger } from '../utils/Logger';

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  /** Maximum requests allowed in the time window */
  maxRequests: number;
  
  /** Time window in milliseconds */
  windowMs: number;
}

/**
 * Rate limit tracking entry
 */
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

/**
 * Validates user permissions and enforces rate limiting
 */
export class UserValidator {
  private userRepo: UserRepository;
  private logger: Logger;
  private rateLimits: Map<string, RateLimitEntry> = new Map();
  private defaultRateLimit: RateLimitConfig = {
    maxRequests: 10,
    windowMs: 60000 // 1 minute
  };
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(userRepo: UserRepository) {
    this.userRepo = userRepo;
    this.logger = new Logger('UserValidator');
    
    // Clean up expired rate limit entries periodically
    this.cleanupInterval = setInterval(() => this.cleanupRateLimits(), 60000);
  }

  /**
   * Clean up resources (call when shutting down)
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Validate and register a user interaction
   * Creates user record if it doesn't exist
   */
  async validateUser(discordId: string, username: string): Promise<boolean> {
    try {
      // Ensure user exists in database
      await this.userRepo.upsertUser(discordId, username);
      
      // Update last active timestamp
      await this.userRepo.updateLastActive(discordId);
      
      return true;
    } catch (error) {
      this.logger.error(`Error validating user ${discordId}:`, error);
      return false;
    }
  }

  /**
   * Check if a user is rate limited
   * Returns true if the user can proceed, false if rate limited
   */
  checkRateLimit(userId: string, config?: RateLimitConfig): boolean {
    const limitConfig = config || this.defaultRateLimit;
    const now = Date.now();
    const key = userId;
    
    let entry = this.rateLimits.get(key);
    
    // Create new entry if doesn't exist or expired
    if (!entry || now >= entry.resetTime) {
      entry = {
        count: 1,
        resetTime: now + limitConfig.windowMs
      };
      this.rateLimits.set(key, entry);
      return true;
    }
    
    // Check if limit exceeded
    if (entry.count >= limitConfig.maxRequests) {
      this.logger.warn(`Rate limit exceeded for user ${userId}`);
      return false;
    }
    
    // Increment counter
    entry.count++;
    return true;
  }

  /**
   * Get remaining requests for a user
   */
  getRemainingRequests(userId: string, config?: RateLimitConfig): number {
    const limitConfig = config || this.defaultRateLimit;
    const entry = this.rateLimits.get(userId);
    
    if (!entry || Date.now() >= entry.resetTime) {
      return limitConfig.maxRequests;
    }
    
    return Math.max(0, limitConfig.maxRequests - entry.count);
  }

  /**
   * Get time until rate limit resets (in milliseconds)
   */
  getResetTime(userId: string): number {
    const entry = this.rateLimits.get(userId);
    
    if (!entry) {
      return 0;
    }
    
    const now = Date.now();
    return Math.max(0, entry.resetTime - now);
  }

  /**
   * Reset rate limit for a user
   */
  resetRateLimit(userId: string): void {
    this.rateLimits.delete(userId);
    this.logger.info(`Rate limit reset for user ${userId}`);
  }

  /**
   * Set custom rate limit configuration
   */
  setDefaultRateLimit(config: RateLimitConfig): void {
    this.defaultRateLimit = config;
    this.logger.info(`Default rate limit updated: ${config.maxRequests} requests per ${config.windowMs}ms`);
  }

  /**
   * Check if user has permission for admin commands
   * Can be extended with role-based permissions
   */
  async hasAdminPermission(discordId: string, serverId: string): Promise<boolean> {
    // Basic implementation - can be extended with role checks
    // For now, this would need to be checked via Discord permissions
    // This is a placeholder for future permission system
    return true;
  }

  /**
   * Validate that a user can start a new game
   */
  async canStartGame(userId: string, username: string): Promise<{
    allowed: boolean;
    reason?: string;
  }> {
    // Validate user
    const isValid = await this.validateUser(userId, username);
    if (!isValid) {
      return {
        allowed: false,
        reason: 'User validation failed'
      };
    }
    
    // Check rate limit
    const withinLimit = this.checkRateLimit(userId);
    if (!withinLimit) {
      const resetTime = this.getResetTime(userId);
      const resetSeconds = Math.ceil(resetTime / 1000);
      return {
        allowed: false,
        reason: `Rate limit exceeded. Try again in ${resetSeconds} seconds.`
      };
    }
    
    return { allowed: true };
  }

  /**
   * Clean up expired rate limit entries
   */
  private cleanupRateLimits(): void {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.rateLimits.entries()) {
      if (now >= entry.resetTime) {
        this.rateLimits.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.debug(`Cleaned up ${cleaned} expired rate limit entries`);
    }
  }

  /**
   * Get rate limit statistics
   */
  getStats(): {
    totalTracked: number;
    activeRateLimits: number;
  } {
    const now = Date.now();
    let active = 0;
    
    for (const entry of this.rateLimits.values()) {
      if (now < entry.resetTime && entry.count >= this.defaultRateLimit.maxRequests) {
        active++;
      }
    }
    
    return {
      totalTracked: this.rateLimits.size,
      activeRateLimits: active
    };
  }
}
