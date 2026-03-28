# Testing the Semantle Integration

This guide shows you how to test the Semantle game integration with the shared game infrastructure.

## Quick Test

Run the simple test to see the integration in action:

```bash
npx ts-node test-semantle-simple.ts
```

This will:
1. Set up an in-memory database
2. Initialize the Semantle game
3. Simulate a user playing the game
4. Test session resumption
5. Test daily puzzle consistency

### Expected Output

```
=== Semantle Integration Demo ===

1. Setting up database...
   Database ready!

2. Initializing game components...
   Loaded 100000 words

3. Starting a game for user "Alice"...
   Session ID: 7018e3082923d58ec4b0b115788080a0
   Target word: music
   Max attempts: 100

4. Making guesses...

   Guess: "water"
   Cold (not in top 1000)

   Guess: "sound"
   Rank: 29/1000 (Similarity: 53.3%)
   Getting warmer!

   Guess: "song"
   Rank: 8/1000 (Similarity: 60.7%)
   Very close!

   Guess: "music"
   Congratulations! You found the word "music" in 5 guesses!

   ** GAME WON! **

5. Final state:
   Completed: true
   Total guesses: 4
   Best rank: 8

6. Testing session resumption...
   Same session? YES
   Guesses preserved? YES

7. Testing daily puzzle consistency...
   User 1 target: music
   User 2 target: music
   Same puzzle? YES

=== All tests passed! ===
```

## Comprehensive Test

For a more detailed test that covers all integration points:

```bash
npx ts-node test-semantle-integration.ts
```

This comprehensive test includes:
- Database and repository setup
- Core infrastructure initialization
- User validation and rate limiting
- Session management
- Session resumption (Requirement 1.2)
- Completed game protection (Requirement 1.4)
- Daily puzzle consistency (Requirement 1.3)
- Multiple user scenarios

## Unit Tests

Run the unit tests for the core infrastructure:

```bash
npm test tests/core/auth
```

This runs tests for:
- SessionManager
- UserValidator
- GameSessionFactory

## What's Being Tested

### 1. Session Management
- Creating new game sessions
- Resuming existing sessions
- Tracking attempts and progress
- Storing game data

### 2. User Validation
- User registration
- Rate limiting
- Permission checking

### 3. Daily Puzzle Consistency
- All users get the same puzzle for a given date
- Puzzles are generated deterministically
- Puzzle data is cached

### 4. Completed Game Protection
- Users can't play the same puzzle twice
- Results are preserved
- Appropriate messages are shown

### 5. Game Logic
- Word validation
- Similarity calculation
- Ranking system
- Guess history

## Integration Architecture

```
Test Script
    ↓
SemantleGame (implements Game interface)
    ↓
SessionManager + SemanticEngine
    ↓
GameStateRepository + DailyPuzzleRepository
    ↓
Database (SQLite in-memory for tests)
```

## Troubleshooting

### "ts-node not found"
Use `npx ts-node` instead of `ts-node`

### "Cannot find module"
Make sure you're in the project root directory and dependencies are installed:
```bash
npm install
```

### Slow loading
The semantic engine loads 100,000 word vectors, which takes ~10 seconds. This is normal.

### Emoji display issues
If you see garbled characters instead of emojis, that's just a PowerShell encoding issue. The tests still pass correctly.

## Next Steps

After verifying the integration works:

1. **Implement Travle and Duotrigordle** using the same pattern
2. **Add Discord bot commands** to expose the games
3. **Write property-based tests** for correctness properties
4. **Add result sharing** functionality
5. **Implement server leaderboards**

## See Also

- [Integration Summary](./INTEGRATION_SUMMARY.md) - Quick start guide
- [Semantle Integration](./SEMANTLE_INTEGRATION.md) - Detailed architecture
- [Integration Example](../examples/semantle-integration-example.ts) - Full Discord bot example
