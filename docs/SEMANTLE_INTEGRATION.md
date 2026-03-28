# Semantle Integration with Shared Game Infrastructure

This document explains how the Semantle game module integrates with the shared game infrastructure.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Discord Bot Layer                        │
│  (Command Handlers: /semantle, /guess, /stats)              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Shared Game Infrastructure                      │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ UserValidator    │  │ SessionManager   │                │
│  │ - Rate limiting  │  │ - Session cache  │                │
│  │ - User validation│  │ - Resumption     │                │
│  └──────────────────┘  └──────────────────┘                │
│                                                              │
│  ┌──────────────────────────────────────────┐              │
│  │      GameSessionFactory                   │              │
│  │  - Game registration                      │              │
│  │  - Daily puzzle coordination              │              │
│  └──────────────────────────────────────────┘              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  Semantle Game Module                        │
│                                                              │
│  ┌──────────────────────────────────────────┐              │
│  │         SemantleGame (implements Game)    │              │
│  │  - startSession()                         │              │
│  │  - processGuess()                         │              │
│  │  - getGameState()                         │              │
│  │  - generateDailyPuzzle()                  │              │
│  └──────────────────┬───────────────────────┘              │
│                     │                                        │
│                     ▼                                        │
│  ┌──────────────────────────────────────────┐              │
│  │         SemanticEngine                    │              │
│  │  - Word similarity calculation            │              │
│  │  - Ranking system                         │              │
│  │  - Vocabulary management                  │              │
│  └──────────────────────────────────────────┘              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                   Storage Layer                              │
│                                                              │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ GameStateRepo    │  │ DailyPuzzleRepo  │                │
│  │ UserRepo         │  │ ConfigRepo       │                │
│  └──────────────────┘  └──────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

## Integration Flow

### 1. Starting a Game

```typescript
// User types: /semantle

Discord Command
    ↓
UserValidator.canStartGame()  // Check rate limits
    ↓
SessionManager.hasCompletedToday()  // Check if already completed
    ↓
GameSessionFactory.createSession()  // Create or resume session
    ↓
SemantleGame.startSession()  // Initialize game-specific data
    ↓
Return game state to user
```

### 2. Making a Guess

```typescript
// User types: /guess word

Discord Command
    ↓
SessionManager.getSession()  // Get active session
    ↓
SemantleGame.processGuess()
    ↓
SemanticEngine.calculateSimilarity()  // Calculate word similarity
    ↓
SemanticEngine.getWordRank()  // Get ranking if in top 1000
    ↓
SessionManager.incrementAttempts()  // Update attempt count
    ↓
SessionManager.updateSession()  // Save guess history
    ↓
[If correct] SessionManager.completeSession()
    ↓
Return feedback to user
```

### 3. Daily Puzzle Generation

```typescript
// Automatic at midnight or on first request

GameSessionFactory.createSession()
    ↓
Check DailyPuzzleRepository for today's puzzle
    ↓
[If not exists] SemantleGame.generateDailyPuzzle()
    ↓
SemanticEngine.getSemanticData()  // Get word rankings
    ↓
DailyPuzzleRepository.createPuzzle()  // Store for all users
    ↓
All users get same puzzle (Requirement 1.3)
```

## Key Benefits of Integration

### 1. **Session Management**
- Automatic session resumption when user returns
- In-memory caching for fast access
- Persistent storage for reliability

### 2. **Daily Puzzle Consistency**
- All users get the same puzzle for a given date
- Puzzles are generated once and cached
- Deterministic generation based on date

### 3. **Completed Game Protection**
- Users can't play the same puzzle twice
- Results are preserved and displayed
- Prevents cheating by restarting

### 4. **Rate Limiting**
- Prevents spam and abuse
- Configurable limits per user
- Automatic cleanup of expired limits

### 5. **User Validation**
- Automatic user registration
- Last active tracking
- Permission checking for admin commands

## Code Example: Minimal Integration

```typescript
// 1. Setup (once at bot startup)
const semanticEngine = new SemanticEngine();
await semanticEngine.initialize();

const semantleGame = new SemantleGame(
  semanticEngine,
  sessionManager,
  dailyPuzzleRepo
);

gameSessionFactory.registerGame(semantleGame);

// 2. Handle /semantle command
const session = await gameSessionFactory.createSession(
  userId,
  serverId,
  'semantle'
);

// 3. Handle /guess command
const result = await semantleGame.processGuess(session.id, guessWord);

// 4. Display result
if (result.isComplete) {
  // Show victory message
} else {
  // Show feedback (rank, similarity, etc.)
}
```

## Requirements Satisfied

| Requirement | How It's Satisfied |
|-------------|-------------------|
| 1.1 - Game command initiation | `GameSessionFactory.createSession()` |
| 1.2 - Session resumption | `SessionManager.getOrCreateSession()` |
| 1.3 - Daily puzzle consistency | `DailyPuzzleRepository` + deterministic generation |
| 1.4 - Completed game protection | `SessionManager.hasCompletedToday()` |
| 2.1 - Similarity calculation | `SemanticEngine.calculateSimilarity()` |
| 2.2 - Top 1000 ranking | `SemanticEngine.getWordRank()` |
| 2.3 - Non-ranked feedback | Cold/tepid logic in `processGuess()` |
| 2.5 - Guess history | Stored in `session.gameData.guesses` |

## Testing the Integration

```typescript
// Unit test example
describe('Semantle Integration', () => {
  it('should create session and process guess', async () => {
    const session = await semantleGame.startSession('user-1', 'server-1');
    expect(session.gameType).toBe('semantle');
    
    const result = await semantleGame.processGuess(session.id, 'house');
    expect(result.isValid).toBe(true);
    expect(result.feedback).toBeDefined();
  });
  
  it('should prevent duplicate guesses', async () => {
    const session = await semantleGame.startSession('user-2', 'server-1');
    
    await semantleGame.processGuess(session.id, 'water');
    const result = await semantleGame.processGuess(session.id, 'water');
    
    expect(result.isValid).toBe(false);
    expect(result.feedback).toContain('already guessed');
  });
});
```

## Next Steps

1. **Implement remaining games** (Travle, Duotrigordle) using the same pattern
2. **Add result sharing** functionality
3. **Implement server leaderboards**
4. **Add admin configuration** commands
5. **Write property-based tests** for correctness properties

## See Also

- [Game Interface Documentation](../core/auth/Game.interface.ts)
- [Session Manager Documentation](../core/auth/SessionManager.ts)
- [Integration Example](../examples/semantle-integration-example.ts)
