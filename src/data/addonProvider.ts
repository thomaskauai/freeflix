import { fetchCatalog, fetchManifest, fetchMeta, type AddonMeta } from './addonClient';
import { CATALOG_NAMES_PT, PARAMETERIZED_CATALOGS } from './catalogNames';
import type { CatalogProvider, Episode, RowRef, Season, Title, TitleType } from './types';

const SIMILAR_LIMIT = 12;
/** destaques no topo da Home */
const FEATURED_COUNT = 4;
/** nota mínima para entrar nos destaques e na fileira de notas altas */
const FEATURED_MIN_RATING = 6.5;
const TOP_RATED_MIN = 7.5;
const TOP_RATED_LIMIT = 24;
/** listas que já vêm em ordem de "mais em alta" ou de data: ficam na página 1 e na ordem do addon */
const TIMELY = [
  'trending-movies',
  'trending-series',
  'airing-today-series',
  'new-and-upcoming-movies',
  'new-and-returning-series',
];
/** sempre no topo da Home, nesta ordem; as outras fileiras vêm embaralhadas */
const PINNED = ['trending-movies', 'trending-series'];
/** páginas de 20 itens sorteadas nas listas sem ordem de data */
const PAGES = 3;

// Sorteio desta abertura do app: muda cada vez que o app abre e fica igual
// enquanto ele está aberto (voltar à Home não reembaralha nada).
const SESSION = Math.floor(Math.random() * 0x7fffffff);

/** Gerador pseudoaleatório com semente: mesma semente, mesma sequência. */
function randomFor(salt: string) {
  let h = SESSION;
  for (let i = 0; i < salt.length; i++) h = (Math.imul(h ^ salt.charCodeAt(i), 0x5bd1e995) + 0x6b43a9b5) | 0;
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(list: T[], salt: string): T[] {
  const random = randomFor(salt);
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

const ratingOf = (t: Title) => (t.rating ? parseFloat(t.rating) || 0 : 0);

/** Alterna os tipos (filme, série, filme…) mantendo a ordem de cada um. */
function alternate(lists: Title[][]): Title[] {
  const out: Title[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) lists.forEach((l) => l[i] && out.push(l[i]));
  return out;
}

/**
 * Destaques entre os títulos em alta de um tipo. Cada um ganha um peso: 60%
 * pela posição em "em alta" (o 1º pesa mais) e 40% pela nota IMDb (5 vale 0,
 * 9 ou mais vale 1). Ficam de fora os sem fotograma, sem sinopse ou com nota
 * abaixo de 6,5. O sorteio é proporcional ao peso ao quadrado: os mais fortes
 * aparecem quase sempre, mas a Home muda a cada abertura.
 */
function pickFeatured(trending: Title[], count: number, salt: string): Title[] {
  const random = randomFor(salt);
  const pool = trending
    .map((t, rank) => {
      const rating = ratingOf(t);
      const quality = rating ? Math.min(1, Math.max(0, (rating - 5) / 4)) : 0.3;
      return { t, weight: Math.pow(0.6 * (1 - rank / trending.length) + 0.4 * quality, 2) };
    })
    .filter(({ t }) => !!t.backdrop && !!t.synopsis && (!t.rating || ratingOf(t) >= FEATURED_MIN_RATING));
  const picked: { t: Title; weight: number }[] = [];
  while (picked.length < count && pool.length) {
    let roll = random() * pool.reduce((sum, p) => sum + p.weight, 0);
    let i = 0;
    while (i < pool.length - 1 && roll >= pool[i].weight) roll -= pool[i++].weight;
    picked.push(pool.splice(i, 1)[0]);
  }
  return picked.sort((a, b) => b.weight - a.weight).map((p) => p.t);
}

/** "109m", "45 min", "1h 30m" → minutos */
function parseRuntime(text?: string): number | undefined {
  if (!text) return undefined;
  const hours = text.match(/(\d+)\s*h/i);
  const minutes = text.match(/(\d+)\s*m/i);
  const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  return total || undefined;
}

// As imagens vêm do TMDB em w500; para um card de 233 px, w342 basta e pesa menos na TV.
const cardPoster = (url?: string) => (url ? url.replace('/t/p/w500/', '/t/p/w342/') : undefined);

function toTitle(meta: AddonMeta): Title {
  const year = meta.releaseInfo ? parseInt(meta.releaseInfo, 10) : NaN;
  return {
    id: meta.id,
    type: meta.type === 'series' ? 'series' : 'movie',
    title: meta.name,
    year: isNaN(year) ? undefined : year,
    runtime: parseRuntime(meta.runtime),
    genres: meta.genres ?? [],
    synopsis: meta.description ?? '',
    poster: cardPoster(meta.poster),
    backdrop: meta.background,
    logo: meta.logo,
    rating: meta.imdbRating,
    originalLanguage: meta.language,
  };
}

function toSeasons(meta: AddonMeta): Season[] {
  const bySeason = new Map<number, Episode[]>();
  (meta.videos ?? []).forEach((v) => {
    // temporada 0 são especiais e extras
    if (!v.season || !v.episode) return;
    const list = bySeason.get(v.season) ?? [];
    list.push({
      number: v.episode,
      title: v.title || v.name || `Episódio ${v.episode}`,
      runtime: parseRuntime(v.runtime),
      thumbnail: v.thumbnail,
    });
    bySeason.set(v.season, list);
  });
  return Array.from(bySeason.keys())
    .sort((a, b) => a - b)
    .map((number) => ({
      number,
      episodes: (bySeason.get(number) ?? []).sort((a, b) => a.number - b.number),
    }));
}

/** Minúsculas, sem acento, só letras e números separados por um espaço. */
export function foldForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Quão bem o nome casa com a busca (já em foldForSearch): 0 quando o título
 * (ou o original) começa com ela, 1 quando alguma palavra começa, 2 no resto.
 */
export function searchTier(title: Title, wanted: string): number {
  let tier = 2;
  [title.title, title.originalTitle].forEach((name) => {
    if (!name || !wanted) return;
    const folded = foldForSearch(name);
    if (folded.indexOf(wanted) === 0) tier = 0;
    else if (tier > 1 && ` ${folded}`.indexOf(` ${wanted}`) >= 0) tier = 1;
  });
  return tier;
}

/**
 * Catálogo servido por um addon. `localized` troca os nomes das listas pelos
 * em português; títulos e sinopses já vêm no idioma do endereço do addon.
 */
export function createAddonProvider(base: string, localized: boolean): CatalogProvider {
  const catalogs = () =>
    fetchManifest(base).then((m) =>
      (m.catalogs ?? []).filter(
        (c) =>
          (c.type === 'movie' || c.type === 'series') &&
          PARAMETERIZED_CATALOGS.indexOf(c.id) < 0 &&
          !(c.extra ?? []).some((e) => e.isRequired),
      ),
    );

  const meta = (type: TitleType, id: string) => fetchMeta(base, type, id).catch(() => null);

  // Títulos vistos em listas, para peekTitle. O /meta deste addon leva segundos.
  const known: Record<string, Title> = {};
  const remember = (list: Title[]) => {
    list.forEach((t) => (known[`${t.type}:${t.id}`] = t));
    return list;
  };

  const page = (type: TitleType, catalogId: string, skip?: number) =>
    fetchCatalog(base, type, catalogId, skip ? { skip: String(skip) } : undefined).then((metas) =>
      remember(metas.map(toTitle)),
    );
  const plural = (type: TitleType) => (type === 'series' ? 'series' : 'movies');

  /**
   * Notas altas no IMDb: aclamados pela crítica (numa página sorteada), em
   * alta e populares, só com nota de 7,5 para cima. Embaralhados a cada
   * abertura e alternando filme e série.
   */
  const topRated = (type?: TitleType) =>
    Promise.all(
      (type ? [type] : (['movie', 'series'] as TitleType[])).map((t) => {
        const acclaimedSkip = Math.floor(randomFor(`top:${t}`)() * PAGES) * 20;
        return Promise.all([
          page(t, `critically-acclaimed-${plural(t)}`, acclaimedSkip).catch(() => [] as Title[]),
          page(t, `trending-${plural(t)}`).catch(() => [] as Title[]),
          page(t, `popular-${plural(t)}`).catch(() => [] as Title[]),
        ]).then((lists) => {
          const seen: Record<string, boolean> = {};
          const good = ([] as Title[])
            .concat(...lists)
            .filter((x) => ratingOf(x) >= TOP_RATED_MIN && !seen[x.id] && (seen[x.id] = true));
          return shuffled(good, `top-items:${t}`);
        });
      }),
    ).then((lists) => alternate(lists).slice(0, TOP_RATED_LIMIT));

  let featured: Promise<Title[]> | null = null;

  return {
    getFeatured() {
      // dois filmes e duas séries em alta, intercalados, do mais forte para o mais fraco
      if (!featured) {
        featured = Promise.all(
          (['movie', 'series'] as TitleType[]).map((t) =>
            page(t, `trending-${plural(t)}`)
              .catch(() => [] as Title[])
              .then((items) => pickFeatured(items, FEATURED_COUNT, `featured:${t}`)),
          ),
        ).then(([movies, series]) => {
          const half = FEATURED_COUNT / 2;
          // faltando de um tipo, o outro completa
          const m = movies.slice(0, Math.max(half, FEATURED_COUNT - Math.min(half, series.length)));
          const s = series.slice(0, FEATURED_COUNT - Math.min(m.length, FEATURED_COUNT));
          return alternate([m, s]).slice(0, FEATURED_COUNT);
        });
        // falhou: a próxima abertura da Home tenta de novo
        featured.then(
          (list) => list.length || (featured = null),
          () => (featured = null),
        );
      }
      return featured;
    },

    async listRows(filter) {
      const list = (await catalogs()).filter((c) => {
        return !filter || c.type === filter;
      });
      const refs = list.map(
        (c): RowRef => ({
          id: `${c.type}:${c.id}`,
          title: (localized && CATALOG_NAMES_PT[c.id]) || c.name,
          style: 'poster',
          type: c.type as TitleType,
          catalogId: c.id,
          // listas sem ordem de data abrem numa página sorteada, embaralhadas
          skip: TIMELY.indexOf(c.id) < 0 ? Math.floor(randomFor(`page:${c.id}`)() * PAGES) * 20 : undefined,
          shuffle: TIMELY.indexOf(c.id) < 0,
        }),
      );
      // Em alta no topo; depois as notas altas; o resto em ordem sorteada a cada abertura.
      const pinned = PINNED.map((id) => refs.filter((r) => r.catalogId === id)[0]).filter(Boolean);
      const topRow: RowRef = {
        id: `top-rated:${filter ?? 'all'}`,
        title: 'Notas altas no IMDb',
        style: 'poster',
        type: filter,
        kind: 'top-rated',
        showRating: true,
      };
      const rest = shuffled(
        refs.filter((r) => pinned.indexOf(r) < 0),
        `rows:${filter ?? 'all'}`,
      );
      return [...pinned, topRow, ...rest].map((r, i) => ({ ...r, style: i === 0 ? 'tall' : r.style }));
    },

    async loadRow(ref) {
      if (ref.kind === 'top-rated') return topRated(ref.type);
      if (!ref.type || !ref.catalogId) return [];
      const items = await page(ref.type, ref.catalogId, ref.skip);
      return ref.shuffle ? shuffled(items, `items:${ref.id}`) : items;
    },

    peekTitle(type, id) {
      return known[`${type}:${id}`] ?? null;
    },

    async getTitle(type, id) {
      const m = await meta(type, id);
      if (!m) return null;
      const seasons = toSeasons(m);
      return {
        ...toTitle(m),
        seasonCount: seasons.length,
        episodeCount: seasons.reduce((n, s) => n + s.episodes.length, 0),
      };
    },

    async getSeasons(type, id) {
      const m = await meta(type, id);
      return m ? toSeasons(m) : [];
    },

    async getSimilar(title) {
      const popular = (await catalogs()).filter((c) => c.id === `popular-${title.type === 'series' ? 'series' : 'movies'}`)[0];
      const genres = (popular?.extra ?? []).filter((e) => e.name === 'genre')[0]?.options ?? [];
      const genre = title.genres.filter((g) => genres.indexOf(g) >= 0)[0];
      if (!popular || !genre) return [];
      const items = await fetchCatalog(base, popular.type, popular.id, { genre }).catch(() => []);
      return remember(
        items
          .map(toTitle)
          .filter((t) => t.id !== title.id)
          .slice(0, SIMILAR_LIMIT),
      );
    },

    async search(q) {
      const query = q.trim();
      if (!query) return [];
      const [movies, series] = await Promise.all(
        (['movie', 'series'] as const).map((type) =>
          fetchCatalog(base, type, `popular-${type === 'series' ? 'series' : 'movies'}`, { search: query })
            .then((items) => remember(items.map(toTitle)))
            .catch(() => [] as Title[]),
        ),
      );
      // intercala para um tipo não empurrar o outro para fora da primeira tela
      const merged: Title[] = [];
      for (let i = 0; i < Math.max(movies.length, series.length); i++) {
        if (movies[i]) merged.push(movies[i]);
        if (series[i]) merged.push(series[i]);
      }
      // quem começa com o que foi digitado vem antes; empate mantém a ordem do addon
      const wanted = foldForSearch(query);
      return merged
        .map((title, i) => ({ title, i, tier: searchTier(title, wanted) }))
        .sort((a, b) => a.tier - b.tier || a.i - b.i)
        .map((entry) => entry.title);
    },
  };
}
