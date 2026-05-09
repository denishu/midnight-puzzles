# Midnight Puzzles — VPS Deployment Guide

## Stack

- Hetzner CX23 VPS, Ubuntu 22.04, Nuremberg
- Node.js 20, PM2, nginx, Let's Encrypt SSL
- Domain on Namecheap, pointing to Hetzner IP via A records

---

## Initial Server Setup

```bash
apt update && apt upgrade -y
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
npm install -g pm2
apt install -y nginx
```

---

## Deploy Code

```bash
git clone https://github.com/denishu/midnight-puzzles.git
cd midnight-puzzles
npm install
npm run build
```

**Important:** `tsc` only compiles `.ts` files. Any non-TypeScript assets (`.sql`, `.json`, data files) must be manually copied to `dist/`:

```bash
cp core/storage/schema-sqlite.sql dist/core/storage/schema-sqlite.sql
cp core/storage/schema.sql dist/core/storage/schema.sql
```

Large data files not in git (GloVe vectors, precomputed rankings) must be copied from your local machine via scp:

```bash
scp data/dictionaries/vectors-840b.bin root@YOUR_IP:/root/midnight-puzzles/data/dictionaries/
scp data/dictionaries/rankings-840b.json root@YOUR_IP:/root/midnight-puzzles/data/dictionaries/
scp data/dictionaries/semantic-vectors.txt root@YOUR_IP:/root/midnight-puzzles/data/dictionaries/
```

Similarly, Vite-built frontend assets not in git must be copied:

```bash
scp web/travle/dist/discord-sdk.js root@YOUR_IP:/root/midnight-puzzles/web/travle/dist/
scp web/semantle/dist/discord-sdk.js root@YOUR_IP:/root/midnight-puzzles/web/semantle/dist/
scp web/duotrigordle/dist/discord-sdk.js root@YOUR_IP:/root/midnight-puzzles/web/duotrigordle/dist/
```

---

## Environment Variables

```bash
cp .env.example .env
nano .env  # fill in real values, set NODE_ENV=production
```

---

## Database Migration

```bash
npm run migrate
```

The migration runs automatically on process startup, but you can run it manually if needed.

---

## TypeScript Path Fix

- Use `process.cwd()` instead of `__dirname` when resolving paths to data files. `__dirname` in compiled JS points to `dist/` not the project root. `process.cwd()` resolves to wherever PM2 is launched from — always launch PM2 from the project root.
- Make sure `web/**/*.ts` is in `tsconfig.json` include array or web server files won't compile.

---

## PM2 Process Management

### Start processes

```bash
pm2 start dist/bot/semantle-bot.js --name semantle
pm2 start dist/bot/travle-bot.js --name travle
pm2 start dist/bot/duotrigordle-bot.js --name duotrigordle
pm2 start dist/web/semantle/server.js --name semantle-web
pm2 start dist/web/travle/server.js --name travle-web
pm2 start dist/web/duotrigordle/server.js --name duotrigordle-web
```

### Save and enable startup

```bash
pm2 save
pm2 startup  # run the output command it gives you
```

### Useful commands

```bash
pm2 logs NAME --lines 20
pm2 restart NAME
pm2 list
```

---

## nginx Config

Located at `/etc/nginx/sites-available/midnightpuzzles`, symlinked to `sites-enabled`.

Each game needs two blocks — a redirect and a proxy:

```nginx
location = /semantle {
    return 301 /semantle/;
}

location /semantle/ {
    proxy_pass http://localhost:3001/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
}
```

Ports: semantle `3001`, travle `3002`, duotrigordle `3003`.

Landing page served from:

```nginx
location / {
    root /root/midnight-puzzles/web/landing;
    index index.html;
}
```

**Fix 403 errors:** nginx runs as `www-data` and can't read files under `/root` by default. Fix permissions:

```bash
chmod 755 /root
chmod -R 755 /root/midnight-puzzles/web/landing
chmod -R 755 /root/midnight-puzzles/web/landing/assets
```

Test and restart nginx:

```bash
nginx -t
systemctl restart nginx
```

---

## SSL

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d playmidnightpuzzles.com -d www.playmidnightpuzzles.com
```

DNS must have propagated before certbot will work. After adding A records on Namecheap, wait at least 15 minutes.

---

## DNS on Namecheap

Advanced DNS → Add two A records:

| Host | Value |
|------|-------|
| `@` | Hetzner IP |
| `www` | Hetzner IP |

---

## Discord Developer Portal

Register Activity URLs under URL Mappings for each app:

- `playmidnightpuzzles.com/semantle`
- `playmidnightpuzzles.com/travle`
- `playmidnightpuzzles.com/duotrigordle`

---

## Deploying Updates

```bash
git pull
npm run build
# Re-copy any non-TypeScript assets if changed
pm2 restart all
```
