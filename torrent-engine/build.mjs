// Gera dist/tizen-service.js: o motor e as dependências num arquivo só, em
// JavaScript que o Node 4.4 da TV antiga (Tizen 5) entende. esbuild junta,
// Babel traduz para ES5; legacy-node.js entra antes de tudo.
//
// Uso: npm run build   (o npm run build:tizen da raiz chama)
import { transformAsync } from '@babel/core';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const bundled = await build({
  entryPoints: [path.join(dir, 'tizen-service.js')],
  inject: [path.join(dir, 'legacy-node.js')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node12',
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
});
const { code } = await transformAsync(bundled.outputFiles[0].text, {
  babelrc: false,
  configFile: false,
  compact: false,
  sourceType: 'script',
  presets: [['@babel/preset-env', { targets: { node: '4.4' }, modules: false }]],
});
await mkdir(path.join(dir, 'dist'), { recursive: true });
await writeFile(path.join(dir, 'dist/tizen-service.js'), `'use strict';\n${code}`);
console.log(`dist/tizen-service.js (${Math.round(code.length / 1024)} KB)`);
