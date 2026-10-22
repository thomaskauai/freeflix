// Lista padrão de fontes de vídeo (src/sources.json), lida pelas TVs a cada
// abertura. O repositório é privado, então o raw do GitHub não serve; cada
// deploy publica aqui a versão do main, e mudar as fontes não exige novo .wgt.
//   GET -> [{ name, url }]
import listed from '../src/sources.json' with { type: 'json' };
import { json, preflight } from './_lib.js';

export const OPTIONS = preflight;

// um minuto no CDN: a mudança chega rápido sem cada abertura bater na função
export const GET = () => json(listed, 200, { 'Cache-Control': 'public, s-maxage=60' });
