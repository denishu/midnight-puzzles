// Builds the browser-ready Discord SDK bundle and replicates it to all three
// games. Run directly (`node scripts/build-sdk.js`) or via `npm run build:sdk`
// (which is folded into `npm run build`, so the bundle can never go stale
// relative to the wrapper source — the failure mode that broke a deploy where
// `getSessionToken` was added to the wrapper but the shipped bundle was old).
//
// Flow:
//   1. Vite bundles web/travle/discord-sdk.js (which has a bare
//      `@discord/embedded-app-sdk` import a browser can't resolve) into a
//      self-contained ES module at web/travle/dist/discord-sdk.js.
//   2. That bundle is copied verbatim to web/semantle/dist and
//      web/duotrigordle/dist so all three games serve an identical, current SDK.
import { build } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync, copyFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(__dirname, '..', 'web');
const travleDir = resolve(webDir, 'travle');

// Games that receive a copy of the bundle (travle is the build source).
const COPY_TARGETS = ['semantle', 'duotrigordle'];

// 1. Bundle the SDK wrapper for travle.
await build({
  root: travleDir,
  build: {
    outDir: resolve(travleDir, 'dist'),
    emptyOutDir: true,
    lib: {
      entry: resolve(travleDir, 'discord-sdk.js'),
      formats: ['es'],
      fileName: 'discord-sdk',
    },
    rollupOptions: {
      output: {
        entryFileNames: 'discord-sdk.js',
      },
    },
  },
});

const source = resolve(travleDir, 'dist', 'discord-sdk.js');
if (!existsSync(source)) {
  console.error(`Expected bundle not found at ${source} — Vite build may have failed.`);
  process.exit(1);
}
console.log('Built web/travle/dist/discord-sdk.js');

// 2. Replicate to the other games (cross-platform; no shell copy commands).
for (const game of COPY_TARGETS) {
  const destDir = resolve(webDir, game, 'dist');
  mkdirSync(destDir, { recursive: true });
  copyFileSync(source, resolve(destDir, 'discord-sdk.js'));
  console.log(`Copied -> web/${game}/dist/discord-sdk.js`);
}

console.log('SDK bundle built and replicated to all three games.');
