# Integration Summary: Shared Game Infrastructure

## Overview

The shared game infrastructure provides a standardized way to implement puzzle games with consistent session management, user validation, and daily puzzle coordination.

## Quick Start

### 1. Implement the Game Interface

```typescript
import { Game, GameSession, GuessResult, GameState, DailyPuzzle } from '../../core/auth/Game.interface';

export class YourGame implements Game {
  name = 'your-game';
  maxAttempts = 50;
  
  async startSession(userId: string, serverId: string): Promise<GameSession> {
    // Create or resume session
  }
  
  async processGuess(sessionId: string, guess: string): Promise<GuessResult> {
    // Process user input
  }
  
  async getGameState(sessionId: string): Promise<GameState> {
    // Return current state
  }
  
  async generateDailyPuzzle(date: Date): Promise<DailyPuzzle> {
    // Generate puzzle for date
  }
}
```

### 2. Register Your Game

```typescript
// At bot startup
const yourGame = new YourGame(dependencies...);
gameSessionFactory.registerGame(yourGame);
```

### 3. Use in Command Handlers

```typescript
// Start game
const session = await gameSessionFactory.createSession(userId, serverId, 'your-game');

// Process input
const result = await yourGame.processGuess(session.id, userInput);

// Get state
const state = await yourGame.getGameState(session.id);
```

## What You Get For Free

### ✅ Session Management
- Automatic session creation and resumption
- In-memory caching for performance
- Persistent storage for reliability

### ✅ User Validation
- Rate limiting to prevent abuse
- User registration and tracking
- Permission checking

### ✅ Daily Puzzles
- Consistent puzzles across all users
- Automatic generation and caching
- Date-based deterministic selection

### ✅ Game State
- Attempt tracking
- Completion detection
- Progress persistence

## Architecture Layers

```
┌─────────────────────────────────────┐
│   Discord Commands (/play, /guess)  │  ← Your bot commands
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   Game Implementation (YourGame)     │  ← Implement Game interface
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   Shared Infrastructure              │  ← Provided by framework
│   - SessionManager                   │
│   - GameSessionFactory               │
│   - UserValidator                    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│   Storage Layer                      │  ← Database repositories
│   - GameStateRepository              │
│   - DailyPuzzleRepository            │
│   - UserRepository                   │
└─────────────────────────────────────┘
```

## Common Patterns

### Pattern 1: Simple Guess-Based Game

```typescript
async processGuess(sessionId: string, guess: string): Promise<GuessResult> {
  const session = await this.sessionManager.getSession(sessionId);
  
  // Validate guess
  if (!this.isValidGuess(guess)) {
    return { isValid: false, feedback: 'Invalid guess', isComplete: false };
  }
  
  // Check if correct
  const isCorrect = this.checkGuess(guess, session.gameData.solution);
  
  // Update session
  await this.sessionManager.incrementAttempts(sessionId);
  
  if (isCorrect) {
    await this.sessionManager.completeSession(sessionId, { success: true });
    return { isValid: true, feedback: 'Correct!', isComplete: true };
  }
  
  return { isValid: true, feedback: 'Try again', isComplete: false };
}
```

### Pattern 2: Multi-Step Game

```typescript
async processGuess(sessionId: string, guess: string): Promise<GuessResult> {
  const session = await this.sessionManager.getSession(sessionId);
  
  // Add guess to history
  session.gameData.moves.push(guess);
  await this.sessionManager.updateSession(sessionId, session.gameData);
  
  // Check if game is complete
  if (this.isGameComplete(session.gameData)) {
    const result = this.calculateResult(session.gameData);
    await this.sessionManager.completeSession(sessionId, result);
    return { isValid: true, feedback: 'Game complete!', isComplete: true };
  }
  
  return { isValid: true, feedback: 'Continue...', isComplete: false };
}
```

### Pattern 3: Daily Puzzle with Seed

```typescript
async generateDailyPuzzle(date: Date): Promise<DailyPuzzle> {
  // Use date as seed for deterministic generation
  const seed = this.hashDate(date);
  const puzzle = this.generateFromSeed(seed);
  
  return {
    id: `${this.name}-${date.toISOString().split('T')[0]}`,
    gameType: this.name,
    date,
    puzzleData: { /* puzzle data */ },
    solution: { /* solution data */ },
    createdAt: new Date()
  };
}
```

## Best Practices

### 1. Keep Game Logic Separate
- Game-specific logic goes in your Game implementation
- Use shared infrastructure for common tasks
- Don't duplicate session management code

### 2. Store Minimal Data
- Only store what's needed to resume the game
- Use `session.gameData` for game-specific state
- Keep it JSON-serializable

### 3. Validate Everything
- Check user input before processing
- Validate session exists and is active
- Handle edge cases gracefully

### 4. Use Async/Await
- All infrastructure methods are async
- Always await database operations
- Handle errors appropriately

### 5. Test Thoroughly
- Unit test your Game implementation
- Test session resumption
- Test completion scenarios

## Example: Complete Integration

See [examples/semantle-integration-example.ts](../examples/semantle-integration-example.ts) for a complete working example of integrating Semantle with the shared infrastructure.

## Troubleshooting

### Session Not Found
```typescript
const session = await sessionManager.getSession(sessionId);
if (!session) {
  return { isValid: false, feedback: 'Session not found', isComplete: false };
}
```

### Game Already Complete
```typescript
if (session.isComplete) {
  return { 
    isValid: false, 
    feedback: 'Game already completed', 
    isComplete: true,
    data: { result: session.result }
  };
}
```

### Rate Limit Exceeded
```typescript
const canStart = await userValidator.canStartGame(userId, username);
if (!canStart.allowed) {
  // Show rate limit message
}
```

## Further Reading

- [Game Interface Documentation](../core/auth/Game.interface.ts)
- [Semantle Integration Guide](./SEMANTLE_INTEGRATION.md)
- [Session Manager API](../core/auth/SessionManager.ts)
- [User Validator API](../core/auth/UserValidator.ts)
