// Gera src/assets/splash.png: a marca da abertura já desenhada, para a TV só
// animar uma imagem pronta. Desenhar o SVG fatiado (96 tiras recortadas) a
// cada quadro, crescendo até 5,5x, travava a animação nas TVs.
// Mudou o desenho? Ajuste aqui e rode: node scripts/render-splash.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const W = 1200;
const H = 400;
const BASELINE = 236;
/** topo das maiúsculas: a deformação estica as letras a partir daqui */
const CAP_TOP = 66;
const STRIPS = 96;
/** quanto o centro da palavra fica mais curto que as pontas */
const ARCH = 0.12;
/** letras altas e estreitas: a fonte é esticada na vertical além do condensado dela */
const TALL = 1.42;
/** pixels por unidade do desenho: na tela a marca tem 0,8 do desenho e cresce, então 1,6 = 2x a tela */
const DENSITY = 1.6;
const RED = '#e5202a';
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const root = new URL('..', import.meta.url).pathname;
const font = readFileSync(join(root, 'node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2'));

// Palavra fatiada em tiras verticais; cada tira é esticada na altura conforme
// a posição: topo reto, letras das pontas mais altas que as do meio.
const step = W / STRIPS;
let clips = '';
let strips = '';
for (let i = 0; i < STRIPS; i++) {
  const u = ((i + 0.5) / STRIPS) * 2 - 1; // -1 nas pontas, 0 no centro
  const scale = TALL * (1 - ARCH * (1 - u * u));
  // meio pixel de sobra evita frestas entre as tiras
  clips += `<clipPath id="s${i}"><rect x="${i * step - 0.5}" y="0" width="${step + 1}" height="${H}"/></clipPath>`;
  strips += `<g clip-path="url(#s${i})"><use href="#word" transform="translate(0 ${CAP_TOP}) scale(1 ${scale}) translate(0 ${-CAP_TOP})"/></g>`;
}

const width = Math.round(W * DENSITY);
const height = Math.round(H * DENSITY);
const html = `<!doctype html><html><head><style>
@font-face { font-family: 'Archivo Variable'; font-weight: 100 900; font-stretch: 62% 125%;
  src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2-variations'); }
html, body { margin: 0; background: transparent; }
svg { display: block; }
text { font-family: 'Archivo Variable'; font-stretch: 62%; font-weight: 900; font-size: 236px; letter-spacing: 2px; fill: ${RED}; }
</style></head><body>
<svg viewBox="0 0 ${W} ${H}" width="${width}" height="${height}"><defs>
<text id="word" x="${W / 2}" y="${BASELINE}" text-anchor="middle">FREEFLIX</text>${clips}
</defs>${strips}</svg></body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'splash-'));
const page = join(dir, 'splash.html');
writeFileSync(page, html);
const out = join(root, 'src/assets/splash.png');
execFileSync(CHROME, [
  '--headless=new',
  '--hide-scrollbars',
  '--default-background-color=00000000',
  `--window-size=${width},${height}`,
  '--virtual-time-budget=3000',
  `--user-data-dir=${join(dir, 'chrome')}`,
  `--screenshot=${out}`,
  `file://${page}`,
], { stdio: 'ignore' });
console.log(`marca em ${out} (${width}x${height})`);
