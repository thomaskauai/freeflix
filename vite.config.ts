import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** versão do app, mostrada em Configurações; a do .wgt sai da mesma fonte */
const VERSION = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string })
  .version;

/** pasta do app empacotável para a TV; fora do git (ver .gitignore) */
export const TIZEN_APP_DIR = 'tizen-build/app';

/**
 * Dentro do .wgt a página abre por file://, e de lá o WebView bloqueia
 * <script type="module"> e recursos com crossorigin (origem "null"). Na TV o
 * bundle vira um script clássico, carregado depois do HTML.
 */
function classicScripts(): Plugin {
  return {
    name: 'freeflix:classic-scripts',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return (
        html
          .replace(/<script type="module" crossorigin/g, '<script defer')
          .replace(/ crossorigin/g, '')
          // APIs da Samsung (identificador da TV), antes do app; a TV resolve o $WEBAPIS
          .replace('</title>', '</title>\n    <script src="$WEBAPIS/webapis/webapis.js"></script>')
      );
    },
  };
}

// base './' + es2015: o bundle precisa rodar de file:// dentro do .wgt,
// no WebView antigo das TVs Tizen (Chromium 63–76).
export default defineConfig(({ mode }) => {
  const tizen = mode === 'tizen';
  return {
    base: './',
    define: { __APP_VERSION__: JSON.stringify(VERSION) },
    plugins: tizen ? [react(), classicScripts()] : [react()],
    build: {
      target: 'es2015',
      cssTarget: 'chrome61',
      modulePreload: false,
      ...(tizen && {
        outDir: TIZEN_APP_DIR,
        emptyOutDir: true,
        // um arquivo só, sem import() dinâmico: script clássico não carrega módulos
        rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
        // CSS num arquivo próprio, no <link> do HTML, em vez de injetado pelo script
        cssCodeSplit: false,
        chunkSizeWarningLimit: 1500,
      }),
    },
    server: { port: 5173 },
  };
});
