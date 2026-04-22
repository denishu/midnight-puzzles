// One-time build script: bundles discord-sdk.js into a browser-ready file
// Run: node web/travle/build-sdk.js
import { build } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  root: __dirname,
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'discord-sdk.js'),
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
