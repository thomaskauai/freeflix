import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import postcssGlobalData from '@csstools/postcss-global-data';
import postcssCustomProperties from 'postcss-custom-properties';

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
//
// mode 'tizen-legacy': TV de 2017/2018 (Tizen 3.0/4.0, WebView Chromium 47/56).
// Mesmo pacote da TV, mais: JS rebaixado até o Chromium 47 (sem desestruturação
// nem parâmetro padrão), polyfills do core-js antes do app, e cada var(--x)
// ganha uma linha anterior com o valor do :root (o Chromium 47 não tem
// variável CSS; ignora a linha com var() e fica com a fixa). Os valores do
// :root em tokens.css já são os da TV 1920×1080.
function legacyPolyfills(): Plugin {
  return {
    name: 'freeflix:legacy-polyfills',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace('</title>', '</title>\n    <script src="vendor/core-js.min.js"></script>');
    },
  };
}

/** O esbuild não rebaixa desestruturação nem parâmetro padrão: o Babel passa no bundle já pronto. */
function legacyTranspile(): Plugin {
  return {
    name: 'freeflix:legacy-transpile',
    apply: 'build',
    enforce: 'post',
    async renderChunk(code) {
      const { transformAsync } = await import('@babel/core');
      const result = await transformAsync(code, {
        babelrc: false,
        configFile: false,
        compact: true,
        sourceType: 'script',
        presets: [['@babel/preset-env', { targets: { chrome: '47' }, modules: false, bugfixes: true }]],
      });
      return result?.code ?? code;
    },
  };
}

export default defineConfig(({ mode }) => {
  const legacy = mode === 'tizen-legacy';
  const tizen = mode === 'tizen' || legacy;
  return {
    base: './',
    define: { __APP_VERSION__: JSON.stringify(VERSION) },
    plugins: tizen
      ? [react(), classicScripts(), ...(legacy ? [legacyPolyfills(), legacyTranspile()] : [])]
      : [react()],
    ...(legacy && {
      css: {
        postcss: {
          // cada CSS é processado sozinho: o :root de tokens.css entra em todos
          plugins: [
            postcssGlobalData({ files: ['src/styles/tokens.css'] }),
            postcssCustomProperties({ preserve: true }),
          ],
        },
      },
    }),
    build: {
      target: 'es2015',
      cssTarget: legacy ? 'chrome47' : 'chrome61',
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
    server: {
      port: 5173,
      // o Vite não roda as funções de api/: no computador, elas vêm do site
      proxy: { '/api': { target: 'https://freefliix.vercel.app', changeOrigin: true } },
    },
  };
});
