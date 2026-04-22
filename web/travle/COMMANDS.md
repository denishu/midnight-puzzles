# Travle — Commands

## Run the app

```bash
# 1. Start the Express server (serves frontend + API on port 3000)
npm run dev:travle-web

# 2. Tunnel to expose localhost to Discord (separate terminal)
cloudflared tunnel --url http://localhost:3000

# 3. Start the Discord bot (slash commands: /play, /guess, etc.) (separate terminal)
npm run dev:travle
```

## One-time / occasional

```bash
# Build the Discord SDK bundle (only needed if you edit discord-sdk.js or update the SDK package)
node web/travle/build-sdk.js

# Deploy slash commands to Discord (run once, or after changing command definitions)
npm run deploy:travle
```

## Env vars needed (in .env)

```
TRAVLE_BOT_TOKEN=       # Discord bot token
TRAVLE_CLIENT_ID=       # Discord application client ID
DISCORD_CLIENT_SECRET=  # Discord OAuth2 client secret (for Activity SDK auth)
```
