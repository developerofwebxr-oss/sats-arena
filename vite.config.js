import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `command` is 'serve' for dev (localhost) and 'build' for the production bundle.
export default defineConfig(({ command }) => ({
  // GitHub Pages serves this project under /sats-arena/, so the production build
  // needs that base or assets 404. Dev stays at root '/' so localhost is unchanged.
  base: command === 'build' ? '/sats-arena/' : '/',

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
