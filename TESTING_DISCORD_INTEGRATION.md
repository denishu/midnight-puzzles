# Testing Discord Integration Layer

This guide explains how to test the Discord integration layer components.

## 1. Unit Tests (Automated)

Run the comprehensive unit tests that verify all components:

```bash
# Run all Discord integration tests
npm test tests/core/discord

# Run specific component tests
npx jest tests/core/discord/DiscordClient.test.ts
npx jest tests/core/discord/InteractionHandler.test.ts
npx jest tests/core/discord/MessageFormatter.test.ts
npx jest tests/core/discord/EmbedBuilder.test.ts
```

**What these tests verify:**
- ✅ Component instantiation and configuration
- ✅ Message formatting and embed creation
- ✅ Interaction handler registration and routing
- ✅ Error handling and edge cases
- ✅ Type safety and API compliance

## 2. Integration Testing with Real Discord Bot

### Prerequisites

1. **Create a Discord Application:**
   - Go to https://discord.com/developers/applications
   - Click "New Application" and give it a name (e.g., "Discord Integration Test")
   - Go to the "Bot" section and create a bot
   - Copy the bot token

2. **Get Application ID:**
   - In the "General Information" section, copy the "Application ID"

3. **Create a Test Server:**
   - Create a Discord server for testing
   - Copy the server ID (enable Developer Mode in Discord settings)

4. **Invite Bot to Server:**
   - Go to OAuth2 > URL Generator
   - Select "bot" and "applications.commands" scopes
   - Select necessary permissions (Send Messages, Use Slash Commands, etc.)
   - Use the generated URL to invite the bot

### Setup Environment

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Configure your .env file:**
   ```env
   # Test Bot Configuration
   DISCORD_TOKEN=your_bot_token_here
   DISCORD_CLIENT_ID=your_application_id_here
   DISCORD_GUILD_ID=your_test_server_id_here
   
   # Other settings...
   LOG_LEVEL=info
   NODE_ENV=development
   ```

### Run the Test Bot

```bash
# Build the project first
npm run build

# Run the test bot
npm run test-bot
```

**Expected output:**
```
🤖 Starting Discord Integration Test Bot...
📤 Deploying test commands...
✅ Test bot is ready!
📋 Available test commands:
  /ping - Test basic response
  /embed-test - Test embed creation
  /format-test - Test message formatting
  /error-test - Test error handling

💡 Try these commands in your Discord server to test the integration layer!
```

### Test Commands

Once the bot is running, test these commands in your Discord server:

1. **`/ping`** - Tests basic interaction handling and response formatting
2. **`/embed-test`** - Tests EmbedBuilder functionality with rich embeds
3. **`/format-test`** - Tests MessageFormatter with game completion formatting
4. **`/error-test`** - Tests error message formatting and handling

### What to Verify

**✅ Basic Functionality:**
- Bot responds to slash commands
- Commands appear in Discord's autocomplete
- Responses are properly formatted

**✅ Message Formatting:**
- Embeds display correctly with colors and fields
- Success/error messages have appropriate styling
- Timestamps and formatting are consistent

**✅ Error Handling:**
- Invalid commands are handled gracefully
- Error messages are user-friendly
- Bot doesn't crash on unexpected input

**✅ Performance:**
- Responses are fast (< 3 seconds as per requirements)
- No memory leaks during extended use
- Graceful shutdown works properly

## 3. Manual Testing Scenarios

### Scenario 1: Command Registration
1. Start the test bot
2. Verify commands are deployed to Discord
3. Check that slash commands appear in Discord UI
4. Test command execution

### Scenario 2: Message Formatting
1. Execute `/format-test` command
2. Verify the embed contains:
   - Game completion status
   - Attempt count
   - Time taken
   - Score
   - Proper colors and emojis

### Scenario 3: Error Handling
1. Execute `/error-test` command
2. Verify error message is:
   - Clearly formatted
   - Uses error color (red)
   - Contains helpful information
   - Marked as ephemeral (only visible to user)

### Scenario 4: Interaction Flow
1. Test rapid command execution
2. Verify no race conditions
3. Check proper cleanup after interactions
4. Test bot restart/reconnection

## 4. Load Testing (Optional)

For more comprehensive testing, you can:

1. **Simulate Multiple Users:**
   ```bash
   # Create multiple test accounts and test concurrent usage
   ```

2. **Stress Test Commands:**
   ```bash
   # Execute commands rapidly to test rate limiting and performance
   ```

3. **Long-Running Test:**
   ```bash
   # Leave bot running for extended periods to test stability
   ```

## 5. Troubleshooting

### Common Issues

**Bot doesn't respond to commands:**
- Check bot token is correct
- Verify bot has necessary permissions
- Ensure commands are deployed (`npm run test-bot` shows deployment)

**Commands don't appear in Discord:**
- Wait a few minutes for global command deployment
- Use guild-specific deployment for faster testing (set DISCORD_GUILD_ID)
- Check bot has `applications.commands` scope

**Permission errors:**
- Verify bot has "Send Messages" and "Use Slash Commands" permissions
- Check channel-specific permissions

**Connection issues:**
- Verify internet connection
- Check Discord API status
- Review bot token validity

### Debug Mode

Enable debug logging by setting:
```env
LOG_LEVEL=debug
```

This will show detailed information about:
- Command registration
- Interaction handling
- Discord API calls
- Error details

## 6. Next Steps

After verifying the Discord integration layer works correctly:

1. **Implement Game Modules** - The integration layer is ready to support game-specific commands
2. **Add Database Integration** - Connect the storage layer for persistent game state
3. **Implement Property-Based Tests** - Add the PBT tests from the task list
4. **Production Deployment** - Configure for production Discord servers

The Discord integration layer provides a solid foundation for building the puzzle bot games!