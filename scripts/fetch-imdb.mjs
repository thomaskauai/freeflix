// Preenche "imdbId" em src/data/catalog.json a partir do Wikidata (P345).
// O id IMDb é o que o addon de legendas usa para achar o título.
// Uso: npm run fetch-imdb
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'src/data/catalog.json');
const UA = 'FreeflixCatalogDemo/0.1 (personal demo project) node-fetch';

async function api(host, params) {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  const res = await fetch(`https://${host}/w/api.php?${qs}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${host}`);
  return res.json();
}

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));

// Duas consultas para o catálogo inteiro: artigo → item do Wikidata → id IMDb.
const pages = await api('en.wikipedia.org', {
  action: 'query',
  titles: catalog.titles.map((t) => t.wiki).join('|'),
  redirects: '1',
  prop: 'pageprops',
  ppprop: 'wikibase_item',
});
const alias = new Map();
for (const step of [...(pages.query.normalized || []), ...(pages.query.redirects || [])]) alias.set(step.from, step.to);
const resolve = (name) => {
  let current = name;
  for (let i = 0; i < 5 && alias.has(current); i++) current = alias.get(current);
  return current;
};
const qidOf = new Map(pages.query.pages.map((p) => [p.title, p.pageprops?.wikibase_item]));

const qids = catalog.titles.map((t) => qidOf.get(resolve(t.wiki))).filter(Boolean);
const { entities } = await api('www.wikidata.org', { action: 'wbgetentities', ids: qids.join('|'), props: 'claims' });

for (const t of catalog.titles) {
  const qid = qidOf.get(resolve(t.wiki));
  const id = qid && entities[qid]?.claims?.P345?.[0]?.mainsnak?.datavalue?.value;
  if (id && /^tt\d+$/.test(id)) t.imdbId = id;
  else delete t.imdbId;
  console.log(`${t.imdbId ? '✓' : '—'} ${t.id}: ${t.imdbId ?? ''}`);
}

await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log('catalog.json atualizado');
