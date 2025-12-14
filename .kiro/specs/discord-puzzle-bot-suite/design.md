# Design Document

## Overview

The Discord Puzzle Bot Suite is a comprehensive gaming system that brings three popular daily puzzle games to Discord servers. The system architecture emphasizes modularity, allowing each game to operate independently while sharing common infrastructure for Discord integration, user management, and data persistence.

The bot leverages Discord's slash commands and interaction system to provide responsive, user-friendly interfaces. Each game maintains its own state management while utilizing shared services for authentication, data storage, and result formatting.

## Architecture

The system follows a modular microservice-inspired architecture within a monorepo structure:

```
discord-puzzle-bot-suite/
├── core/                    # Shared infrastructure
│   ├── discord/            # Discord API integration
│   ├── storage/            # Data persistence layer
│   ├── auth/               # User session management
│   └── utils/              # Common utilities
├── games/                  # Game-specific modules
│   ├── semantle/           # Semantic word guessing
│   ├── travle/             # Geography pathfinding
│   └── duotrigordle/       # Multi-grid Wordle
├── data/                   # Static game data
│   ├── dictionaries/       # Word lists and semantic vectors
│   ├── geography/          # Country adjacency data
│   └── schemas/            # Data validation schemas
└── bot/                    # Main Discord bot entry point
```

### Key Architectural Principles

1. **Game Independence**: Each game operates as a self-contained module with its own logic and state management
2. **Shared Infrastructure**: Common services (Discord API, storage, user management) are centralized to avoid duplication
3. **Event-Driven Communication**: Games communicate with the core system through well-defined events and interfaces
4. **Stateless Operations**: Game logic is designed to be stateless where possible, with state persisted externally
5. **Extensibility**: New games can be added by implementing standard interfaces without modifying existing code

## Components and Interfaces

### Core Components

#### Discord Integration Layer
- **DiscordClient**: Manages bot connection and event handling
- **InteractionHandler**: Processes slash commands and button interactions
- **MessageFormatter**: Standardizes response formatting across games
- **EmbedBuilder**: Creates rich Discord embeds for game interfaces

#### Storage Layer
- **GameStateRepository**: Persists and retrieves user game sessions
- **DailyPuzzleRepository**: Manages daily puzzle generation and caching
- **UserRepository**: Handles user preferences and statistics
- **ConfigRepository**: Stores server-specific configuration

#### Authentication & Session Management
- **SessionManager**: Tracks active user sessions across games
- **UserValidator**: Validates user permissions and rate limits
- **GameSessionFactory**: Creates and initializes new game sessions

### Game-Specific Components

#### Semantle Module
- **SemanticEngine**: Calculates word similarity using pre-computed vectors
- **WordRankingService**: Manages the top-1000 similarity rankings
- **SemanticGameState**: Tracks user guesses and progress
- **SimilarityCalculator**: Interfaces with semantic vector database

#### Travle Module
- **CountryGraph**: Represents world map as adjacency graph
- **PathValidator**: Validates country connections and routes
- **MapRenderer**: Generates visual representations of paths
- **GeographyService**: Provides country data and validation

#### Duotrigordle Module
- **GridManager**: Manages 32 simultaneous Wordle grids
- **WordValidator**: Validates 5-letter word guesses
- **GridRenderer**: Formats multi-grid display for Discord
- **ProgressTracker**: Monitors completion across all grids

### Interface Definitions

```typescript
interface Game {
  name: string;
  startSession(userId: string, serverId: string): Promise<GameSession>;
  processGuess(sessionId: string, guess: string): Promise<GuessResult>;
  getGameState(sessionId: string): Promise<GameState>;
  generateDailyPuzzle(date: Date): Promise<DailyPuzzle>;
}

interface GameSession {
  id: string;
  userId: string;
  gameType: string;
  startTime: Date;
  isComplete: boolean;
  attempts: number;
  maxAttempts: number;
}

interface GuessResult {
  isValid: boolean;
  feedback: string;
  isComplete: boolean;
  nextPrompt?: string;
}
```

## Data Models

### Core Data Models

#### User
```typescript
interface User {
  discordId: string;
  username: string;
  preferences: UserPreferences;
  statistics: GameStatistics;
  createdAt: Date;
  lastActive: Date;
}

interface UserPreferences {
  defaultGameMode: string;
  shareResults: boolean;
  receiveReminders: boolean;
  timezone: string;
}
```

#### Game Session
```typescript
interface GameSession {
  id: string;
  userId: string;
  serverId: string;
  gameType: 'semantle' | 'travle' | 'duotrigordle';
  puzzleDate: Date;
  startTime: Date;
  endTime?: Date;
  isComplete: boolean;
  attempts: number;
  maxAttempts: number;
  gameData: Record<string, any>;
  result?: GameResult;
}
```

#### Daily Puzzle
```typescript
interface DailyPuzzle {
  id: string;
  gameType: string;
  date: Date;
  puzzleData: Record<string, any>;
  solution?: Record<string, any>;
  createdAt: Date;
}
```

### Game-Specific Data Models

#### Semantle Data
```typescript
interface SemanticPuzzle {
  targetWord: string;
  semanticRankings: Map<string, number>;
  wordVectors: Map<string, number[]>;
}

interface SemanticGuess {
  word: string;
  similarity: number;
  rank?: number;
  timestamp: Date;
}
```

#### Travle Data
```typescript
interface TravlePuzzle {
  startCountry: string;
  endCountry: string;
  optimalPath: string[];
  maxAttempts: number;
}

interface CountryConnection {
  from: string;
  to: string;
  isLandBorder: boolean;
  isValid: boolean;
}
```

#### Duotrigordle Data
```typescript
interface DuotrigordlePuzzle {
  targetWords: string[]; // Array of 32 words
  gridStates: GridState[];
  maxAttempts: number;
}

interface GridState {
  gridIndex: number;
  targetWord: string;
  guesses: WordGuess[];
  isComplete: boolean;
}

interface WordGuess {
  word: string;
  feedback: LetterFeedback[];
  timestamp: Date;
}

interface LetterFeedback {
  letter: string;
  position: number;
  status: 'correct' | 'present' | 'absent';
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Core System Properties

**Property 1: Command-to-game mapping consistency**
*For any* valid game command, the system should always initiate the correct corresponding game type
**Validates: Requirements 1.1**

**Property 2: Session resumption consistency**
*For any* user requesting a daily puzzle they've already started, the system should resume the existing session rather than creating a new one
**Validates: Requirements 1.2**

**Property 3: Daily puzzle consistency across users**
*For any* given date and game type, all users should receive identical puzzle content
**Validates: Requirements 1.3**

**Property 4: Completed game protection**
*For any* completed game session, subsequent attempts should display results without allowing new gameplay
**Validates: Requirements 1.4**

### Semantle Game Properties

**Property 5: Semantic similarity calculation consistency**
*For any* word pair, semantic similarity calculations should be deterministic and use the semantic dictionary
**Validates: Requirements 2.1**

**Property 6: Ranking display accuracy**
*For any* word in the top 1000 similar words, the system should display the exact correct ranking number
**Validates: Requirements 2.2**

**Property 7: Non-ranked word feedback**
*For any* word not in the top 1000, the system should provide appropriate "cold" or "tepid" feedback based on similarity thresholds
**Validates: Requirements 2.3**

**Property 8: Guess history preservation**
*For any* sequence of guesses in a game session, all guesses should be stored with their correct rankings and remain accessible
**Validates: Requirements 2.5**

### Travle Game Properties

**Property 9: Valid country pair generation**
*For any* new Travle game, the start and end countries should have at least one valid land connection path
**Validates: Requirements 3.1**

**Property 10: Country adjacency validation**
*For any* country guess, validation should correctly use the adjacency graph to determine connection validity
**Validates: Requirements 3.2**

**Property 11: Path building consistency**
*For any* valid country guess, the path should grow correctly and maintain connection integrity
**Validates: Requirements 3.3**

**Property 12: Invalid guess handling**
*For any* invalid country connection attempt, the guess should be rejected and remaining attempts decremented
**Validates: Requirements 3.4**

### Duotrigordle Game Properties

**Property 13: Word uniqueness in grid generation**
*For any* new Duotrigordle game, all 32 target words should be unique and valid 5-letter words from the dictionary
**Validates: Requirements 4.1**

**Property 14: Simultaneous grid application**
*For any* word guess, it should be applied to all 32 grids simultaneously with consistent processing
**Validates: Requirements 4.2**

**Property 15: Comprehensive feedback generation**
*For any* guess processed, color-coded feedback should be generated for every position across all 32 grids
**Validates: Requirements 4.3**

**Property 16: Grid completion tracking**
*For any* correctly guessed target word, that specific grid should be marked complete and excluded from future displays
**Validates: Requirements 4.4**

### Result Sharing Properties

**Property 17: Standardized result generation**
*For any* completed game, the result summary should contain all required statistics in a standardized format
**Validates: Requirements 5.1**

**Property 18: Spoiler tag formatting**
*For any* shared result, spoiler tags should be used appropriately to prevent solution revelation
**Validates: Requirements 5.2**

**Property 19: Required result information**
*For any* shared result, it should include game type, completion status, attempt count, and time taken
**Validates: Requirements 5.3**

**Property 20: Visual representation inclusion**
*For any* applicable game result, visual representations should be included when relevant
**Validates: Requirements 5.4**

**Property 21: Server stats display without solution revelation**
*For any* server leaderboard request, daily stats should be displayed for all server members without revealing puzzle solutions
**Validates: Requirements 5.6, 5.7**

### Configuration and Administration Properties

**Property 22: Server-specific game configuration**
*For any* server configuration change, games should be enabled or disabled correctly for that specific server
**Validates: Requirements 6.1**

**Property 23: Statistics privacy preservation**
*For any* usage statistics request, aggregate data should be provided without exposing individual player information
**Validates: Requirements 6.3**

**Property 24: Custom word list integration**
*For any* provided custom word list, validation should occur and valid words should be integrated into the dictionary
**Validates: Requirements 6.4**

**Property 25: Settings persistence**
*For any* server setting modification, changes should persist and apply to all future game sessions
**Validates: Requirements 6.5**

### Data Integrity Properties

**Property 26: Input parsing round-trip**
*For any* valid game input, parsing then formatting should produce equivalent data
**Validates: Requirements 7.1**

**Property 27: Game data serialization round-trip**
*For any* game state object, JSON serialization then deserialization should produce an equivalent object
**Validates: Requirements 7.2**

**Property 28: Retry logic consistency**
*For any* external API failure, retry attempts should follow exponential backoff patterns correctly
**Validates: Requirements 7.4**

## Error Handling

### Input Validation
- All user inputs are validated against game-specific schemas before processing
- Invalid commands return helpful error messages with usage examples
- Malformed data is rejected with clear feedback about expected formats

### Game State Recovery
- Game sessions are automatically saved after each significant state change
- Corrupted game states trigger fallback to last known good state
- Critical failures result in graceful degradation with user notification

### Discord API Resilience
- Rate limiting is handled with automatic retry and backoff
- Network failures trigger reconnection attempts with exponential delays
- Message sending failures are logged and retried up to 3 times

### Data Consistency
- Database transactions ensure atomic updates to game state
- Concurrent access is managed through optimistic locking
- Data validation occurs at multiple layers to prevent corruption

## Testing Strategy

### Dual Testing Approach

The system employs both unit testing and property-based testing to ensure comprehensive correctness validation:

- **Unit tests** verify specific examples, edge cases, and error conditions
- **Property tests** verify universal properties that should hold across all inputs
- Together they provide comprehensive coverage: unit tests catch concrete bugs, property tests verify general correctness

### Unit Testing Requirements

Unit tests focus on:
- Specific examples that demonstrate correct behavior for each game type
- Integration points between Discord API and game modules
- Error handling scenarios with known inputs
- Edge cases like empty inputs, boundary values, and invalid states

### Property-Based Testing Requirements

Property-based testing uses **fast-check** library for JavaScript/TypeScript to implement the correctness properties defined above. Each property-based test:

- Runs a minimum of 100 iterations to ensure statistical confidence
- Is tagged with a comment explicitly referencing the design document property
- Uses the format: `**Feature: discord-puzzle-bot-suite, Property {number}: {property_text}**`
- Implements exactly one correctness property from the design document
- Generates appropriate random inputs to test universal behaviors

### Test Organization

```
tests/
├── unit/                   # Specific example tests
│   ├── games/             # Game-specific unit tests
│   ├── core/              # Core system unit tests
│   └── integration/       # Component integration tests
├── property/              # Property-based tests
│   ├── semantle.test.ts   # Semantle properties
│   ├── travle.test.ts     # Travle properties
│   ├── duotrigordle.test.ts # Duotrigordle properties
│   └── core.test.ts       # Core system properties
└── fixtures/              # Test data and utilities
    ├── dictionaries/      # Sample word lists
    ├── geography/         # Test country data
    └── generators/        # Property test generators
```

### Test Data Management

- Semantic similarity vectors use a subset of real data for testing
- Country adjacency data includes comprehensive test coverage
- Word dictionaries contain both valid and invalid examples
- Mock Discord API responses simulate various interaction scenarios