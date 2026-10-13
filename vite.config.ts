import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' + es2015: o bundle precisa rodar de file:// dentro do .wgt,
// no WebView antigo das TVs Tizen (Chromium 63–76).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2015',
    cssTarget: 'chrome61',
    modulePreload: false,
  },
  server: { port: 5173 },
});
