// Preenche "videos" em src/data/catalog.json com arquivos de vídeo livres do
// Wikimedia Commons ligados ao artigo de cada título (filme completo, capítulos
// de seriado ou, na falta, trailer). O app toca direto de upload.wikimedia.org.
// Uso: npm run fetch-video
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'src/data/catalog.json');
const UA = 'FreeflixCatalogDemo/0.1 (personal demo project) node-fetch';
const PACE_MS = 1100;
const MIN_SECONDS = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(params) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let attempt = 0; ; attempt++) {
    await sleep(PACE_MS);
    const res = await fetch(`https://en.wikipedia.org/w/api.php?${qs}`, { headers: { 'User-Agent': UA } });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 6) throw new Error(`${res.status} depois de ${attempt + 1} tentativas`);
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      await sleep(Math.max(retryAfter * 1000, 3000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }
}

// Transcode leve o bastante para TV e rede doméstica; o original pode ter vários GB.
function pickSource(info) {
  const webm = (info.derivatives || []).filter((d) => /webm/.test(d.type || '') && d.height);
  for (const height of [480, 360, 720, 240]) {
    const hit = webm.find((d) => d.height === height);
    if (hit) return hit.src;
  }
  return webm.length ? webm[0].src : info.url;
}

function episodeNumber(name) {
  const m = name.match(/(?:chapter|episode|ch\.?|ep\.?|part)[ _-]*(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

for (const t of catalog.titles) {
  try {
    const data = await api({
      action: 'query',
      titles: t.wiki,
      redirects: '1',
      generator: 'images',
      gimlimit: 'max',
      prop: 'videoinfo',
      viprop: 'url|size|mime|derivatives',
    });
    const videos = (data.query?.pages || [])
      .filter((p) => p.imagerepository === 'shared' && p.videoinfo?.[0])
      .map((p) => ({ name: p.title, ...p.videoinfo[0] }))
      .filter((v) => /^video\//.test(v.mime || '') && (v.duration || 0) >= MIN_SECONDS)
      .map((v) => {
        const entry = { name: v.name, url: pickSource(v), duration: Math.round(v.duration) };
        const episode = t.type === 'series' ? episodeNumber(v.name) : null;
        if (episode) entry.episode = episode;
        return entry;
      })
      // filme: o mais longo primeiro (o completo antes do trailer); série: por capítulo
      .sort((a, b) => (t.type === 'series' ? (a.episode ?? 99) - (b.episode ?? 99) : b.duration - a.duration));

    if (videos.length) t.videos = videos;
    else delete t.videos;
    console.log(
      `${videos.length ? '✓' : '—'} ${t.id}: ${videos
        .map((v) => `${v.episode ? `E${v.episode} ` : ''}${Math.round(v.duration / 60)}min ${v.name}`)
        .join(' | ')}`,
    );
  } catch (err) {
    console.log(`✗ ${t.id}: ${err.message}`);
  }
}

await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log('catalog.json atualizado');
