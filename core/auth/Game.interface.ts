/**
 * Core Game interface that all game implementations must follow
 */
export interface Game {
  /** Unique identifier for the game type */
  name: string;
  
  /** Maximum attempts allowed for this game */
  maxAttempts: number;
  
  /**
   * Start a new game session for a user
   * @param userId Discord user ID
   * @param serverId Discord server ID
   * @returns Promise resolving to the created game session
   */
  startSession(userId: string, serverId: string): Promise<GameSession>;
  
  /**
   * Process a user's guess/move in the game
   * @param sessionId Unique session identifier
   * @param guess User's input (word, country, etc.)
   * @returns Promise resolving to the result of the guess
   */
  processGuess(sessionId: string, guess: string): Promise<GuessResult>;
  
  /**
   * Get the current state of a game session
   * @param sessionId Unique session identifier
   * @returns Promise resolving to the current game state
   */
  getGameState(sessionId: string): Promise<GameState>;
  
  /**
   * Generate a new daily puzzle for the specified date
   * @param date Date for which to generate the puzzle
   * @returns Promise resolving to the daily puzzle data
   */
  generateDailyPuzzle(date: Date): Promise<DailyPuzzle>;
}

/**
 * Represents an active game session
 */
export interface GameSession {
  /** Unique session identifier */
  id: string;
  
  /** Discord user ID */
  userId: string;
  
  /** Discord server ID */
  serverId: string;
  
  /** Type of game (semantle, travle, duotrigordle) */
  gameType: string;
  
  /** Date of the puzzle being played */
  puzzleDate: Date;
  
  /** When the session started */
  startTime: Date;
  
  /** When the session ended (null if ongoing) */
  endTime: Date | null;
  
  /** Whether the game has been completed */
  isComplete: boolean;
  
  /** Number of attempts made so far */
  attempts: number;
  
  /** Maximum attempts allowed */
  maxAttempts: number;
  
  /** Game-specific data (guesses, state, etc.) */
  gameData: Record<string, any>;
  
  /** Final result data (null if not complete) */
  result: Record<string, any> | null;
}

/**
 * Result of processing a guess
 */
export interface GuessResult {
  /** Whether the guess was valid */
  isValid: boolean;
  
  /** Feedback message to display to the user */
  feedback: string;
  
  /** Whether this guess completed the game */
  isComplete: boolean;
  
  /** Optional prompt for the next action */
  nextPrompt?: string;
  
  /** Additional data specific to the game */
  data?: Record<string, any>;
}

/**
 * Current state of a game session
 */
export interface GameState {
  /** Session information */
  session: GameSession;
  
  /** Current progress indicator (e.g., "5/37 attempts") */
  progress: string;
  
  /** Whether the game can accept more guesses */
  canContinue: boolean;
  
  /** Game-specific state data */
  state: Record<string, any>;
}

/**
 * Daily puzzle data
 */
export interface DailyPuzzle {
  /** Unique puzzle identifier */
  id: string;
  
  /** Game type */
  gameType: string;
  
  /** Date of the puzzle */
  date: Date;
  
  /** Puzzle-specific data (target word, country pair, etc.) */
  puzzleData: Record<string, any>;
  
  /** Solution data (may be hidden until completion) */
  solution?: Record<string, any>;
  
  /** When the puzzle was created */
  createdAt: Date;
}
