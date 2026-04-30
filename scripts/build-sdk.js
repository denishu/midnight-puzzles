// One-time build script: bundles discord-sdk.js into a browser-ready file
// Run: node scripts/build-sdk.js
import { build } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const travleDir = resolve(__dirname, '..', 'web', 'travle');

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

console.log('Built web/travle/dist/discord-sdk.js');
console.log('Copy to other games: Copy-Item web/travle/dist web/semantle/dist -Recurse');
console.log('Copy to other games: Copy-Item web/travle/dist web/duotrigordle/dist -Recurse');
