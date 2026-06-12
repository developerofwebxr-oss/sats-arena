import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import basicSsl from '@vitejs/plugin-basic-ssl';

// __dirname isn't defined in ESM (package.json has "type":"module") — derive it.
const __dirname = dirname(fileURLToPath(import.meta.url));

// `command` is 'serve' for dev (localhost) and 'build' for the production bundle.
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this project under /sats-arena/, so the production build
  // needs that base or assets 404. Dev stays at root '/' so localhost is unchanged.
  base: command === 'build' ? '/sats-arena/' : '/',

  // Two pages: the game (index.html) and the lightweight payment page (pay.html).
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        pay:  resolve(__dirname, 'pay.html'),
      },
    },
  },

  // HTTPS is required for WebXR — browsers refuse immersive-vr sessions on plain HTTP.
  // basicSsl generates a self-signed cert automatically; you'll see a browser warning
  // on first load — just click "proceed anyway". (Dev server only; ignored by build.)
  plugins: [basicSsl()],
  server: {
    https: true,
    // Expose to local network so you can test on a Quest headset on the same WiFi.
    host: true,
  },
}));
