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
import { StreakRepository } from '../core/storage/StreakRepository';
import { updateStreaks, clientGuildResolver } from './shared/updateStreaks';
import { makeStreakHandler } from './shared/streakCommand';
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
  private streakRepo!: StreakRepository;

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
    this.streakRepo = new StreakRepository(db);

    // Initialize your game here

    await super.start();
    this.scheduleDailyMessage();
  }

  private scheduleDailyMessage(): void {
    // Stagger AFTER the existing games so recaps land in order in shared
    // servers (semantle 00:01, travle 00:02, duotri 00:03 UTC -> pick the next).
    cron.schedule('4 0 * * *', () => this.postDailyMessage(), { timezone: 'UTC' });
  }

  private async postDailyMessage(): Promise<void> {
    // Same pattern as travle/semantle:
    // 1. Query yesterday's completed sessions
    // 2. updateStreaks BEFORE the purge, membership-gated via the REST resolver:
    //      await updateStreaks('newgame', this.sessionRepo, this.streakRepo,
    //        clientGuildResolver(this.client, this.logger), this.logger);
    //    (This advances WIN-only streaks for guilds the bot is in, resolves
    //    guild name/icon for the leaderboard, and skips user-install/bot-less
    //    guilds. See bot/shared/updateStreaks.ts.)
    // 3. Purge old sessions + clear cache
    // 3. For each guild: calculate streak → post recap → post new puzzle
  }

  protected registerCommands(): void {
    this.commandRegistry.register({ name: 'play', description: '...', handler: this.handlePlay.bind(this) });
    this.commandRegistry.register({ name: 'results', description: '...', handler: this.handleResults.bind(this) });
    this.commandRegistry.register({ name: 'streak', description: 'See your NewGame streak and the server record', handler: makeStreakHandler('newgame', this.streakRepo, this.logger) });
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

## 6b. Register the game in shared allowlists (easy to miss)

Several places hardcode the set of valid games. If you skip these, the new game
will silently not appear on the leaderboard and some ops scripts will reject it:

- `core/web/BaseGameServer.ts` — `ALLOWED_GAMES` in the `/api/leaderboard`
  handler (public leaderboard rejects unknown `?game=`).
- `scripts/seed-streaks.ts` — `ALLOWED_GAMES` (and the `DEFAULT_DB` map).
- `scripts/backfill-streak-meta.ts` / `scripts/audit-guilds.ts` — `GAME_TOKENS`
  / `DEFAULT_DB` maps, if you want the streak ops tooling to cover the new game.
- `BotConfig.gameType` union in `bot/shared/BaseBotApplication.ts` (and any
  other `'semantle' | 'travle' | 'duotrigordle'` union types) — add `'newgame'`.

No DB migration is needed: streaks and sessions key off `game_type` as a string,
so a new game reuses the existing `game_sessions` / `streaks` tables.

---

## Making It an Activity

### 7. Enable Activities in Developer Portal

1. Go to your app → **Activities** → Enable
2. Check **Web** under Supported Platforms
3. Save

### 8. Create the Web Server (extends `BaseGameServer`)

Web servers are NOT hand-rolled anymore. `core/web/BaseGameServer.ts` owns the
~90%-shared parts: Express setup, DB/repo init, the `/game/discord/token`
exchange, **server-side Discord token verification + signed session tokens**
(auth middleware), rate limiting, the `/game/complete` results post, the public
`/api/leaderboard` endpoint, and static file serving. You supply a small config
object plus two hooks.

Create `web/newgame/server.ts`:

```typescript
import { config } from 'dotenv';
import { Express } from 'express';
import { BaseGameServer, GameServerConfig } from '../../core/web/BaseGameServer';
import { resolveUserId } from '../../core/auth/ActivityAuth';
import { Logger } from '../../core/utils/Logger';
// ... your game imports (validator, game session class)

config();
const log = new Logger('newgame-web');

const CONFIG: GameServerConfig = {
  gameType: 'newgame',
  dbFile: 'newgame-bot.db',
  clientIdEnv: 'NEWGAME_CLIENT_ID',
  clientSecretEnv: 'NEWGAME_CLIENT_SECRET',
  botTokenEnv: 'NEWGAME_BOT_TOKEN',
  requiredEnv: ['NEWGAME_CLIENT_ID', 'NEWGAME_CLIENT_SECRET', 'NEWGAME_BOT_TOKEN'], // fail-fast at boot
  port: process.env.NEWGAME_PORT || 3004,
  staticDir: 'web/newgame',
  configLabel: 'newgame-web',
  rateLimits: [
    { paths: '/game', maxRequests: 120, windowMs: 60_000, bucket: 'newgame-all' },
    { paths: ['/game/guess'], maxRequests: 45, windowMs: 60_000, bucket: 'newgame-play' },
  ],
  completeEmbed: { title: '🎯 NewGame Results', color: 0x8b5cf6, channelKey: 'newgame' },
};

const server = new BaseGameServer(CONFIG);

server.listen(
  // --- init hook: build the game object, return session hooks ---
  async (ctx) => {
    // e.g. load word lists, construct your GameSession with ctx.sessionManager
    return {
      startSession: async (userId, serverId) => {
        // create/find today's persisted session, return its id
        return /* sessionId */ '';
      },
      onDailyCleanup: () => { /* clear any in-memory anon caches */ },
    };
  },
  // --- registerRoutes hook: your game-specific endpoints ---
  (app: Express, base: BaseGameServer) => {
    app.get('/game/state', async (req, res) => {
      const id = resolveUserId(req);                     // server-verified id (NOT req.query.id)
      const username = req.authUsername ?? (req.query.username as string | undefined);
      const guildId = req.query.guildId as string | undefined;
      const sessionId = await base.getOrCreateSession(id, username, guildId);
      // ... build + return state
    });

    app.post('/game/guess', async (req, res) => {
      const id = resolveUserId(req);
      // validate input via core/utils/InputValidator, process guess, return state
    });
  },
);
```

Key points vs. the old pattern:
- **Never trust `req.query.id`.** Use `resolveUserId(req)` / `req.authUsername`
  — the auth middleware verifies the Discord token and issues a signed session
  token, so the server knows the real user. (This closed a P0 IDOR.)
- The token endpoint, `/game/complete`, `/api/leaderboard`, rate limiting, and
  config validation are all provided by `BaseGameServer` — do not re-implement.
- Validate guesses with `core/utils/InputValidator` (e.g. `validateWordleGuess`).
- Look at `web/duotrigordle/server.ts` for a full, current example.

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
- [ ] Env vars added (TOKEN, CLIENT_ID, CLIENT_SECRET) + `.env.example`
- [ ] Game logic in `games/newgame/` (pure, no Discord dep) + unit tests
- [ ] Bot in `bot/newgame-bot.ts` with /setchannel + /streak + daily cron
- [ ] Daily cron calls `updateStreaks(..., clientGuildResolver(this.client, this.logger), ...)` BEFORE the purge
- [ ] npm scripts added
- [ ] Game registered in shared allowlists (step 6b: `ALLOWED_GAMES`, gameType unions, ops-script maps)
- [ ] Commands deployed
- [ ] Activities enabled in Developer Portal
- [ ] Web server in `web/newgame/server.ts` extending `BaseGameServer` (config + init/registerRoutes hooks)
- [ ] Endpoints use `resolveUserId(req)` / `req.authUsername` — never `req.query.id`
- [ ] Guess input validated via `core/utils/InputValidator`
- [ ] Frontend with SDK auth in `web/newgame/`
- [ ] SDK bundle copied to `web/newgame/dist/`
- [ ] Client ID in `<meta>` tag
- [ ] Tunnel running, URL Mapping configured
- [ ] Bot has channel permissions
- [ ] Test in voice channel
