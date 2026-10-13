// Addon de fontes de teste, para verificar o Freeflix sem depender de terceiros.
// Responde a qualquer título com o mesmo punhado de fontes, todas apontando
// para um filme em domínio público do Wikimedia Commons, com rótulos variados
// para exercitar a escolha automática.
// Uso: node scripts/mock-addon.mjs   →   http://localhost:7077/manifest.json
//      http://localhost:7077/torrent/manifest.json devolve só fontes de torrent.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 7077);
const FILM =
  'https://upload.wikimedia.org/wikipedia/commons/transcoded/e/ee/The_General_%281926%29.webm/The_General_%281926%29.webm.480p.vp9.webm';

const manifest = (id, name) => ({
  id,
  name,
  version: '1.0.0',
  description: 'Fontes de teste em domínio público',
  resources: ['stream'],
  types: ['movie', 'series'],
  idPrefixes: ['tt', 'tmdb:'],
  catalogs: [],
});

const streams = [
  // a melhor no papel (1080p, original, mais seeds), mas o link está quebrado:
  // o player precisa passar sozinho para a próxima
  { name: 'Teste\n1080p', title: 'Filme.1080p.WEB.x264\n👤 900 💾 2 GB', url: `http://localhost:${PORT}/quebrado.mp4` },
  { name: 'Teste\n1080p', title: 'Filme.1080p.WEB.x264\n👤 300 💾 2 GB', url: `${FILM}?v=1080-original` },
  { name: 'Teste\n1080p', title: 'Filme.1080p.Dublado.x264\n👤 150 💾 2 GB 🇧🇷', url: `${FILM}?v=1080-dublado` },
  // espelhos do mesmo arquivo: na lista de fontes viram uma linha só
  ...['Zeus', 'Hypex', 'Figgs', 'Atlas'].map((server) => ({
    name: 'Teste\n1080p',
    title: `Filme.1080p.Dublado.x264\n🇧🇷 Dublado\n⚡ ${server}`,
    url: `${FILM}?v=1080-dublado-${server}`,
  })),
  { name: 'Teste\n720p', title: 'Filme.720p.WEB.x264\n👤 800 💾 1 GB', url: `${FILM}?v=720-original` },
  { name: 'Teste\n4K', title: 'Filme.2160p.HDR.x265\n👤 700 💾 18 GB', url: `${FILM}?v=4k` },
  { name: 'Teste\n1080p', title: 'Filme.1080p.torrent\n👤 5000', infoHash: '0123456789abcdef0123456789abcdef01234567' },
];

const torrentOnly = [
  { name: 'Teste\n1080p', title: 'Filme.1080p\n👤 5000 💾 2 GB', infoHash: '0123456789abcdef0123456789abcdef01234567' },
  { name: 'Teste\n720p', title: 'Filme.720p\n👤 900 💾 1 GB', infoHash: '89abcdef0123456789abcdef0123456789abcdef' },
];

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  res.setHeader('Access-Control-Allow-Origin', '*');
  const json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  if (path === '/manifest.json') return json(manifest('local.freeflix.teste', 'Fonte de teste'));
  if (path === '/torrent/manifest.json') return json(manifest('local.freeflix.teste.torrent', 'Fonte de teste (torrent)'));
  if (path.startsWith('/torrent/stream/')) return json({ streams: torrentOnly });
  if (path.startsWith('/stream/')) return json({ streams });
  res.statusCode = 404;
  res.end('not found');
}).listen(PORT, () => console.log(`addon de teste em http://localhost:${PORT}/manifest.json`));
