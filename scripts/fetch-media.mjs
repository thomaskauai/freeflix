// Enriquece src/data/catalog.json com pôster, backdrop e tmdbId.
// Fonte: Wikipedia (só imagens de licença livre hospedadas no Commons) e Wikidata.
// Uso: npm run fetch-media            baixa tudo
//      npm run fetch-media -- --list  só lista os candidatos a backdrop
// Para fixar uma imagem, ponha "posterFile" ou "backdropFile" no título em
// catalog.json com o nome exato do arquivo no Commons ("File:..."); com null,
// o título fica sem aquela imagem e a UI usa o fallback.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'src/data/catalog.json');
const mediaDir = path.join(root, 'public/media');
const UA = 'FreeflixCatalogDemo/0.1 (personal demo project) node-fetch';
const LIST_ONLY = process.argv.includes('--list');
const PACE_MS = 1100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Wikimedia limita clientes anônimos: uma requisição por vez, com pausa e retry.
async function request(url) {
  for (let attempt = 0; ; attempt++) {
    await sleep(PACE_MS);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= 6) throw new Error(`${res.status} depois de ${attempt + 1} tentativas`);
      const retryAfter = Number(res.headers.get('retry-after')) || 0;
      await sleep(Math.max(retryAfter * 1000, 3000 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res;
  }
}

async function api(host, params) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  return (await request(`https://${host}/w/api.php?${qs}`)).json();
}

async function download(url, base) {
  const m = new URL(url).pathname.match(/\.(jpe?g|png|webp)$/i);
  const ext = (m ? m[1] : 'jpg').toLowerCase().replace('jpeg', 'jpg');
  const file = `${base}.${ext}`;
  const res = await request(url);
  await writeFile(path.join(mediaDir, file), Buffer.from(await res.arrayBuffer()));
  return `media/${file}`;
}

const STOPWORDS = new Set(['film', 'from', 'with', 'serial', 'series', 'paramount', 'presents', 'last', 'little']);
const tokensOf = (t) =>
  [t.wiki, t.originalTitle]
    .join(' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w));

const fold = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** Imagens do artigo em paisagem, do Commons, cujo nome remete ao título. */
async function backdropCandidates(t, pageTitle, pageimage) {
  const data = await api('en.wikipedia.org', {
    action: 'query',
    titles: pageTitle,
    generator: 'images',
    gimlimit: 'max',
    prop: 'imageinfo',
    iiprop: 'url|size',
    iiurlwidth: '1280',
  });
  const tokens = tokensOf(t);
  return (data.query?.pages || [])
    .filter((p) => p.imagerepository === 'shared' && p.imageinfo?.[0])
    .map((p) => ({ name: p.title, ...p.imageinfo[0] }))
    .filter((i) => /\.(jpe?g|png)$/i.test(i.name))
    .filter((i) => i.width >= 800 && i.width / i.height >= 1.2 && i.width / i.height <= 2.6)
    .map((i) => {
      const name = fold(i.name);
      const related = tokens.some((w) => name.includes(w));
      const still = /still|screenshot|scene|trailer|frame/.test(name);
      const printed = /poster|lobby|card|advert|herald|\bad\b|logo|title/.test(name);
      const isPageImage = i.name.replace(/^File:/, '').replace(/ /g, '_') === pageimage;
      let score = Math.min(i.width, 1920);
      if (still) score += 2000;
      if (isPageImage) score += 1000;
      if (printed) score -= 1500;
      return { ...i, related: related || still || isPageImage, score };
    })
    .filter((i) => i.related)
    .sort((a, b) => b.score - a.score);
}

async function fileInfo(fileTitle, width) {
  const data = await api('en.wikipedia.org', {
    action: 'query',
    titles: fileTitle,
    prop: 'imageinfo',
    iiprop: 'url|size',
    iiurlwidth: String(width),
  });
  const info = data.query?.pages?.[0]?.imageinfo?.[0];
  return info ? { name: fileTitle, ...info } : null;
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
await mkdir(mediaDir, { recursive: true });

// 1. Uma consulta para todos os artigos: imagem principal (só livre) e item do Wikidata.
const pagesQuery = await api('en.wikipedia.org', {
  action: 'query',
  titles: catalog.titles.map((t) => t.wiki).join('|'),
  redirects: '1',
  prop: 'pageimages|pageprops',
  piprop: 'name',
  pilicense: 'free',
  ppprop: 'wikibase_item',
});
const alias = new Map();
for (const step of [...(pagesQuery.query.normalized || []), ...(pagesQuery.query.redirects || [])]) {
  alias.set(step.from, step.to);
}
const resolve = (name) => {
  let current = name;
  for (let i = 0; i < 5 && alias.has(current); i++) current = alias.get(current);
  return current;
};
const pageByTitle = new Map(pagesQuery.query.pages.map((p) => [p.title, p]));

// 2. Uma consulta para todos os ids do TMDB (P4947 filme, P4983 série).
const qids = catalog.titles
  .map((t) => pageByTitle.get(resolve(t.wiki))?.pageprops?.wikibase_item)
  .filter(Boolean);
const entities = qids.length
  ? (await api('www.wikidata.org', { action: 'wbgetentities', ids: qids.join('|'), props: 'claims' })).entities
  : {};
const claim = (qid, prop) => entities[qid]?.claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;

// 3. Imagens, um título por vez.
for (const t of catalog.titles) {
  try {
    const page = pageByTitle.get(resolve(t.wiki));
    if (!page || page.missing) {
      console.log(`✗ ${t.id}: artigo não encontrado (${t.wiki})`);
      continue;
    }

    const qid = page.pageprops?.wikibase_item;
    if (qid) {
      const id = t.type === 'series' ? claim(qid, 'P4983') ?? claim(qid, 'P4947') : claim(qid, 'P4947') ?? claim(qid, 'P4983');
      t.tmdbId = id ? Number(id) : null;
    }

    const candidates = await backdropCandidates(t, page.title, page.pageimage);
    if (LIST_ONLY) {
      console.log(`${t.id} [pageimage=${page.pageimage ?? '—'}]`);
      candidates.slice(0, 6).forEach((c) => console.log(`    ${c.width}x${c.height} ${c.name}`));
      continue;
    }

    // posterFile: null descarta a imagem principal (ex.: quadro de vídeo ilegível).
    const posterName =
      t.posterFile === null ? null : t.posterFile ?? (page.pageimage ? `File:${page.pageimage}` : null);
    let poster = posterName ? await fileInfo(posterName, 500) : null;
    // Imagem principal em paisagem precisa de mais largura para cobrir um card em pé.
    if (poster && poster.width > poster.height) poster = await fileInfo(posterName, 1280);
    if (poster) t.poster = await download(poster.thumburl || poster.url, `${t.id}-poster`);

    // backdropFile: "File:..." fixa a imagem; null diz que nenhum candidato serve.
    let backdrop = candidates[0];
    if (t.backdropFile === null) backdrop = null;
    else if (t.backdropFile) backdrop = await fileInfo(t.backdropFile, 1280);
    // Imagem principal em paisagem (fotograma) também serve de fundo.
    if (!backdrop && t.backdropFile !== null && poster && poster.width > poster.height) backdrop = poster;

    if (backdrop) t.backdrop = await download(backdrop.thumburl || backdrop.url, `${t.id}-backdrop`);
    else delete t.backdrop;
    // Sem imagem principal livre, o card usa o fotograma.
    if (!poster) {
      if (t.backdrop) t.poster = t.backdrop;
      else delete t.poster;
    }

    console.log(`✓ ${t.id}: poster=${poster ? 'ok' : '—'} backdrop=${backdrop ? backdrop.name : '—'} tmdb=${t.tmdbId ?? '—'}`);
  } catch (err) {
    console.log(`✗ ${t.id}: ${err.message}`);
  }
}

if (!LIST_ONLY) {
  await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  console.log('catalog.json atualizado');
}
