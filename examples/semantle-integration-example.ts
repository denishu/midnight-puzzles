/**
 * Example: How to integrate Semantle with the shared game infrastructure
 * 
 * This file demonstrates the complete integration flow from bot command
 * to game execution using the shared infrastructure.
 */

import { ChatInputCommandInteraction } from 'discord.js';
import { SemantleGame } from '../games/semantle/SemantleGame';
import { SemanticEngine } from '../games/semantle/SemanticEngine';
import { SessionManager } from '../core/auth/SessionManager';
import { GameSessionFactory } from '../core/auth/GameSessionFactory';
import { UserValidator } from '../core/auth/UserValidator';
import { GameStateRepository } from '../core/storage/GameStateRepository';
import { DailyPuzzleRepository } from '../core/storage/DailyPuzzleRepository';
import { UserRepository } from '../core/storage/UserRepository';
import { DatabaseConnection } from '../core/storage/DatabaseConnection';

// ============================================================================
// STEP 1: Initialize all dependencies
// ============================================================================

async function setupGameInfrastructure() {
  // Database connection
  const db = new DatabaseConnection({
    type: 'sqlite',
    database: './data/game.db'
  });
  await db.connect();

  // Repositories
  const gameStateRepo = new GameStateRepository(db);
  const dailyPuzzleRepo = new DailyPuzzleRepository(db);
  const userRepo = new UserRepository(db);

  // Core infrastructure
  const sessionManager = new SessionManager(gameStateRepo);
  const userValidator = new UserValidator(userRepo);
  const gameSessionFactory = new GameSessionFactory(sessionManager, dailyPuzzleRepo);

  // Semantle-specific components
  const semanticEngine = new SemanticEngine();
  await semanticEngine.initialize();

  // Create Semantle game instance
  const semantleGame = new SemantleGame(
    semanticEngine,
    sessionManager,
    dailyPuzzleRepo
  );
  await semantleGame.initialize();

  // Register the game with the factory
  gameSessionFactory.registerGame(semantleGame);

  return {
    gameSessionFactory,
    sessionManager,
    userValidator,
    semantleGame
  };
}

// ============================================================================
// STEP 2: Create Discord command handlers
// ============================================================================

/**
 * Handler for /semantle command - starts or resumes a game
 */
async function handleSemantleCommand(
  interaction: ChatInputCommandInteraction,
  infrastructure: Awaited<ReturnType<typeof setupGameInfrastructure>>
) {
  const { gameSessionFactory, userValidator, semantleGame } = infrastructure;
  
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const serverId = interaction.guildId || 'dm';

  try {
    // Step 1: Validate user and check rate limits
    const canStart = await userValidator.canStartGame(userId, username);
    if (!canStart.allowed) {
      await interaction.reply({
        content: `❌ ${canStart.reason}`,
        ephemeral: true
      });
      return;
    }

    // Step 2: Check if user already completed today's puzzle
    const hasCompleted = await infrastructure.sessionManager.hasCompletedToday(
      userId,
      'semantle'
    );

    if (hasCompleted) {
      await interaction.reply({
        content: '✅ You already completed today\'s Semantle! Come back tomorrow for a new puzzle.',
        ephemeral: true
      });
      return;
    }

    // Step 3: Create or resume session
    const session = await gameSessionFactory.createSession(
      userId,
      serverId,
      'semantle'
    );

    // Step 4: Get current game state
    const gameState = await semantleGame.getGameState(session.id);

    // Step 5: Format and send response
    let message = '🎮 **Semantle - Daily Word Puzzle**\n\n';
    
    if (session.attempts === 0) {
      message += 'Find the secret word by guessing words and seeing how semantically similar they are!\n\n';
      message += '📊 Words ranked in the top 1000 will show their exact rank.\n';
      message += '❄️ Other words will show as "cold" or "tepid".\n\n';
      message += 'Use `/guess <word>` to make a guess!';
    } else {
      message += `📈 **Progress**: ${gameState.progress}\n`;
      message += `🎯 **Best Rank**: ${gameState.state.bestRank || 'None yet'}\n`;
      message += `📝 **Total Guesses**: ${gameState.state.totalGuesses}\n\n`;
      
      if (gameState.state.recentGuesses.length > 0) {
        message += '**Recent Guesses:**\n';
        gameState.state.recentGuesses.forEach((guess: any) => {
          const rankStr = guess.rank ? `#${guess.rank}` : 'Not ranked';
          message += `• ${guess.word}: ${rankStr}\n`;
        });
      }
      
      message += '\nUse `/guess <word>` to continue!';
    }

    await interaction.reply({ content: message, ephemeral: false });

  } catch (error) {
    console.error('Error handling semantle command:', error);
    await interaction.reply({
      content: '❌ An error occurred while starting the game. Please try again.',
      ephemeral: true
    });
  }
}

/**
 * Handler for /guess command - processes a word guess
 */
async function handleGuessCommand(
  interaction: ChatInputCommandInteraction,
  infrastructure: Awaited<ReturnType<typeof setupGameInfrastructure>>
) {
  const { sessionManager, semantleGame } = infrastructure;
  
  const userId = interaction.user.id;
  const guess = interaction.options.getString('word', true);

  try {
    // Step 1: Get user's active session
    const session = await sessionManager.getOrCreateSession(
      userId,
      interaction.guildId || 'dm',
      'semantle',
      100
    );

    if (!session) {
      await interaction.reply({
        content: '❌ No active game found. Use `/semantle` to start a new game!',
        ephemeral: true
      });
      return;
    }

    // Step 2: Process the guess
    const result = await semantleGame.processGuess(session.id, guess);

    // Step 3: Format response
    let message = '';
    
    if (!result.isValid) {
      message = `❌ ${result.feedback}`;
    } else if (result.isComplete) {
      message = `${result.feedback}\n\n`;
      message += '🎊 Game completed! Share your results with `/share`';
    } else {
      message = `**Guess**: ${guess}\n${result.feedback}\n\n`;
      if (result.nextPrompt) {
        message += result.nextPrompt;
      }
    }

    await interaction.reply({ content: message, ephemeral: false });

  } catch (error) {
    console.error('Error handling guess command:', error);
    await interaction.reply({
      content: '❌ An error occurred while processing your guess. Please try again.',
      ephemeral: true
    });
  }
}

/**
 * Handler for /stats command - shows user statistics
 */
async function handleStatsCommand(
  interaction: ChatInputCommandInteraction,
  infrastructure: Awaited<ReturnType<typeof setupGameInfrastructure>>
) {
  const { sessionManager } = infrastructure;
  const userId = interaction.user.id;

  try {
    // Get user's active sessions
    const sessions = sessionManager.getUserSessions(userId);
    const semantleSessions = sessions.filter(s => s.gameType === 'semantle');

    let message = '📊 **Your Semantle Statistics**\n\n';
    
    if (semantleSessions.length === 0) {
      message += 'No games played yet. Use `/semantle` to start!';
    } else {
      const completed = semantleSessions.filter(s => s.isComplete).length;
      const inProgress = semantleSessions.filter(s => !s.isComplete).length;
      
      message += `✅ Completed: ${completed}\n`;
      message += `⏳ In Progress: ${inProgress}\n`;
    }

    await interaction.reply({ content: message, ephemeral: true });

  } catch (error) {
    console.error('Error handling stats command:', error);
    await interaction.reply({
      content: '❌ An error occurred while fetching statistics.',
      ephemeral: true
    });
  }
}

// ============================================================================
// STEP 3: Register commands with Discord
// ============================================================================

export async function registerSemantleCommands(client: any) {
  const commands = [
    {
      name: 'semantle',
      description: 'Start or resume today\'s Semantle puzzle'
    },
    {
      name: 'guess',
      description: 'Make a guess in your active Semantle game',
      options: [
        {
          name: 'word',
          description: 'The word you want to guess',
          type: 3, // STRING
          required: true
        }
      ]
    },
    {
      name: 'stats',
      description: 'View your Semantle statistics'
    }
  ];

  // Register commands with Discord API
  // (Implementation depends on your Discord.js setup)
}

// ============================================================================
// STEP 4: Main bot setup
// ============================================================================

export async function setupSemantleBot() {
  // Initialize infrastructure
  const infrastructure = await setupGameInfrastructure();

  // Return command handlers
  return {
    handleSemantleCommand: (interaction: ChatInputCommandInteraction) => 
      handleSemantleCommand(interaction, infrastructure),
    handleGuessCommand: (interaction: ChatInputCommandInteraction) => 
      handleGuessCommand(interaction, infrastructure),
    handleStatsCommand: (interaction: ChatInputCommandInteraction) => 
      handleStatsCommand(interaction, infrastructure),
  };
}

// ============================================================================
// Usage Example
// ============================================================================

/*
// In your main bot file:

import { Client, GatewayIntentBits } from 'discord.js';
import { setupSemantleBot } from './examples/semantle-integration-example';

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let commandHandlers: any;

client.once('ready', async () => {
  console.log('Bot is ready!');
  
  // Setup Semantle bot
  commandHandlers = await setupSemantleBot();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case 'semantle':
      await commandHandlers.handleSemantleCommand(interaction);
      break;
    case 'guess':
      await commandHandlers.handleGuessCommand(interaction);
      break;
    case 'stats':
      await commandHandlers.handleStatsCommand(interaction);
      break;
  }
});

client.login(process.env.DISCORD_TOKEN);
*/
