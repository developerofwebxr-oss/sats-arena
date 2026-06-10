import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  // HTTPS is required for WebXR — browsers refuse immersive-vr sessions on plain HTTP.
  // basicSsl generates a self-signed cert automatically; you'll see a browser warning
  // on first load — just click "proceed anyway".
  plugins: [basicSsl()],
  server: {
    https: true,
    // Expose to local network so you can test on a Quest headset on the same WiFi.
    host: true,
  },
});
