# Adding a New Bot

Guide for adding a new game bot to the suite, including Activity support.

## 1. Create the Discord App

1. Go to https://discord.com/developers/applications
2. Click "New Application", name it
3. Under **Bot** → click "Add Bot"
4. Copy the **Bot Token**
5. Under **OAuth2** → copy the **Client ID** and **Client Secret**
6. Under **OAuth2** → add redirect URL: `https://127.0.0.1`
7. Under **Installation** → generate an invite link with scopes: `bot`, `applications.commands`
8. Invite the bot to your test server

## 2. Add Environment Variables

In `.env`:
```
NEWGAME_BOT_TOKEN=<bot token>
NEWGAME_CLIENT_ID=<client id>
NEWGAME_CLIENT_SECRET=<client secret>
```

Update `.env.example` too.

## 3. Create the Game Logic

Create `games/newgame/` with your pure game logic (no Discord dependency):
- Game state management
- Guess/move processing
- Daily puzzle generation (deterministic from date hash)
- Win/loss conditions

## 4. Create the Bot

Create `bot/newgame-bot.ts`:

```typescript
import { config } from 'dotenv';
import { BaseBotApplication } from './shared/BaseBotApplication';
import { ConfigRepository } from '../core/storage/ConfigRepository';
import { GameStateRepository } from '../core/storage/GameStateRepository';
import { UserRepository } from '../core/storage/UserRepository';
import { DatabaseConnectionFactory } from '../core/storage/DatabaseConnection';
import { MigrationManager } from '../core/storage/migrations/migrate';
import { EmbedBuilder } from '../core/discord/EmbedBuilder';
// @ts-ignore
import cron from 'node-cron';

config();

export class NewGameBot extends BaseBotApplication {
  private configRepo!: ConfigRepository;
  private sessionRepo!: GameStateRepository;
  private userRepo!: UserRepository;

  constructor() {
    super({
      botName: 'NewGame',
      gameType: 'newgame',
      token: process.env.NEWGAME_BOT_TOKEN!,
      clientId: process.env.NEWGAME_CLIENT_ID!,
    });
  }

  public async start(): Promise<void> {
    const db = await DatabaseConnectionFactory.create({
      type: (process.env.NODE_ENV === 'production' ? 'postgresql' : 'sqlite') as any,
      database: process.env.DATABASE_URL || 'newgame-bot.db',
    });
    await new MigrationManager(db).migrate();
    this.configRepo = new ConfigRepository(db);
    this.sessionRepo = new GameStateRepository(db);
    this.userRepo = new UserRepository(db);

    // Initialize your game here

    await super.start();
    this.scheduleDailyMessage();
  }

  private scheduleDailyMessage(): void {
    cron.schedule('0 0 * * *', () => this.postDailyMessage(), { timezone: 'UTC' });
  }

  private async postDailyMessage(): Promise<void> {
    // Same pattern as travle/semantle:
    // 1. Query yesterday's completed sessions
    // 2. Purge old sessions + clear cache
    // 3. For each guild: calculate streak → post recap → post new puzzle
  }

  protected registerCommands(): void {
    this.commandRegistry.register({ name: 'play', description: '...', handler: this.handlePlay.bind(this) });
    this.commandRegistry.register({ name: 'results', description: '...', handler: this.handleResults.bind(this) });
    this.commandRegistry.register({ name: 'help', description: '...', handler: this.handleHelp.bind(this) });
    this.commandRegistry.register({ name: 'setchannel', description: 'Set this channel for daily messages (admin only)', handler: this.handleSetChannel.bind(this) });
  }

  private async handleSetChannel(interaction: any): Promise<void> {
    if (!interaction.memberPermissions?.has('ManageGuild')) {
      await interaction.reply({ content: 'Need "Manage Server" permission.', ephemeral: true });
      return;
    }
    await this.configRepo.setChannelId(interaction.guildId, interaction.channelId);
    await interaction.reply({ content: `✅ Daily messages will post in <#${interaction.channelId}>`, ephemeral: true });
  }

  // ... other handlers
}

if (require.main === module) {
  new NewGameBot().start().catch(e => { console.error(e); process.exit(1); });
}
```

## 5. Add npm Scripts

In `package.json`:
```json
"dev:newgame": "ts-node bot/newgame-bot.ts",
"dev:newgame-web": "ts-node web/newgame/server.ts",
"deploy:newgame": "ts-node -e \"const { NewGameBot } = require('./bot/newgame-bot'); new NewGameBot().deployCommands()\""
```

## 6. Deploy Commands

```bash
npm run deploy:newgame
```

This registers slash commands with Discord. Run again whenever you add/change commands.

---

## Making It an Activity

### 7. Enable Activities in Developer Portal

1. Go to your app → **Activities** → Enable
2. Check **Web** under Supported Platforms
3. Save

### 8. Create the Web Server

Create `web/newgame/server.ts`:

```typescript
import express from 'express';
import path from 'path';
import { config } from 'dotenv';
// ... your game imports

config();
const app = express();
app.use(express.json());

// Cache prevention for API routes
app.use('/game', (_req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  next();
});

// Discord OAuth token exchange
app.post('/game/discord/token', async (req, res) => {
  const { code } = req.body;
  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.NEWGAME_CLIENT_ID || '',
      client_secret: process.env.NEWGAME_CLIENT_SECRET || '',
      grant_type: 'authorization_code',
      code,
    }),
  });
  const { access_token } = await response.json() as any;
  res.json({ access_token });
});

// Your game API endpoints
app.get('/game/state', ...);
app.post('/game/guess', ...);

// Results posting (uses /setchannel channel from DB)
app.post('/game/complete', async (req, res) => {
  const { message, serverId } = req.body;
  // Look up channel from configRepo, post embed via Discord REST API
});

// Serve static files
app.use(express.static(path.resolve(process.cwd(), 'web/newgame')));

const PORT = process.env.NEWGAME_PORT || 3004;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
```

### 9. Create the Frontend

Create `web/newgame/index.html`:
- Add `<meta name="discord-client-id" content="YOUR_CLIENT_ID">`
- Load the script as `<script type="module" src="app-game.js?v=1"></script>`

### 10. Copy the SDK Bundle

```bash
Copy-Item -Recurse web/travle/dist web/newgame/dist
```

Or rebuild it: `node scripts/build-sdk.js` (output goes to `web/travle/dist/`, copy from there).

### 11. Wire Up SDK Auth in Frontend

In `web/newgame/app-game.js`:
```javascript
import { initDiscord, getDiscordUser, getDiscordGuildId } from './dist/discord-sdk.js';

let sessionUserId = null;
let discordGuildId = null;

async function boot() {
  const discord = await initDiscord();
  if (discord) {
    sessionUserId = discord.user.id;
    discordGuildId = discord.guildId;
  }
  // Load game state using sessionUserId as the session key
}

boot();
```

### 12. Start the Tunnel

```bash
npm run dev:newgame-web
cloudflared tunnel --url http://localhost:3004
```

### 13. Configure URL Mapping

In Developer Portal → Activities → URL Mappings:
- Prefix: `/` → Target: `your-tunnel-url.trycloudflare.com`
- Prefix: `/api` → Target: `your-tunnel-url.trycloudflare.com`

(No `https://` prefix on the URL)

### 14. Give Bot Channel Access

If your test channel is role-restricted, add the bot to the channel permissions with "View Channel" and "Send Messages" enabled.

### 15. Launch

First-time setup (required to make the Activity appear):

1. In Discord desktop app → Settings → Developer → turn on **Developer Mode**
2. Settings → Developer → turn on **Application Test Mode**
3. Enter your bot's **Client ID** as the Application ID
4. Leave the other fields as default (localhost, port 8080)
5. Open **Discord in browser** (discord.com/app) → join a voice channel → launch the Activity from the rocket button
6. Do NOT set an Activity URL Override
7. Once it works in browser, it will appear as a launchable Activity the **Discord desktop app**

If the Activity doesn't appear in the shelf: make sure Activities is enabled in the Developer Portal, Web platform is checked, and you've refreshed/restarted Discord.

---

## Checklist Summary

- [ ] Discord app created with bot
- [ ] Env vars added (TOKEN, CLIENT_ID, CLIENT_SECRET)
- [ ] Game logic in `games/newgame/`
- [ ] Bot in `bot/newgame-bot.ts` with /setchannel + daily cron
- [ ] npm scripts added
- [ ] Commands deployed
- [ ] Activities enabled in Developer Portal
- [ ] Web server in `web/newgame/server.ts`
- [ ] Frontend with SDK auth in `web/newgame/`
- [ ] SDK bundle copied to `web/newgame/dist/`
- [ ] Client ID in `<meta>` tag
- [ ] Tunnel running, URL Mapping configured
- [ ] Bot has channel permissions
- [ ] Test in voice channel
