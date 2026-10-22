import { fetchCatalog, fetchManifest, fetchMeta, getJson, type AddonMeta } from './addonClient';
import { STREAMING } from '../settings';
import { CATALOG_NAMES_PT, GENRE_NAMES_PT, HIDDEN_CATALOGS, PARAMETERIZED_CATALOGS } from './catalogNames';
import { read, write } from './storage';
import { isSoap, type CatalogProvider, type Episode, type RowRef, type Season, type Title, type TitleType } from './types';

const SIMILAR_LIMIT = 12;
/** destaques no topo da Home */
const FEATURED_COUNT = 4;
/** nota mínima para entrar nos destaques e na fileira de notas altas */
const FEATURED_MIN_RATING = 6.5;
const TOP_RATED_MIN = 7.5;
const TOP_RATED_LIMIT = 24;
/** listas que já vêm em ordem de "mais em alta" ou de data: começam na página 1 */
const TIMELY = ['trending-movies', 'trending-series', 'new-and-upcoming-movies', 'new-and-returning-series'];
/** sempre no topo, nesta ordem; as outras fileiras seguem a ordem do addon */
const PINNED = ['trending-movies', 'trending-series'];
/** listas sem ordem de data começam numa destas primeiras páginas de 20, sorteada */
const PAGES = 4;
const PAGE_SIZE = 20;
/** o addon de streamings devolve 100 por vez; a fileira mostra de 20 em 20 */
const STREAMING_BLOCK = 100;
/** novelas em português do catálogo: páginas de 20 lidas (o resto já não é novela) */
const NOVELA_PAGES = 4;
/** Globoplay no addon de streamings */
const GLOBOPLAY = 'gop';
/** fileiras de streaming entram depois desta lista (a última das de streaming do addon) */
const STREAMING_AFTER = 'prime-video-';

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

/** "2026-06-11T00:00:00.000Z" → "11/06/2026" (a data é do dia, sem fuso) */
function airDate(iso?: string): string | null {
  const m = iso ? iso.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

/** Novela não tem nome de capítulo, só o número; a data em que foi ao ar diz mais. */
function episodeName(v: NonNullable<AddonMeta['videos']>[number]): string {
  const name = v.title || v.name || `Episódio ${v.episode}`;
  const date = airDate(v.released);
  return date && /^cap[ií]tulo\s*\d+$/i.test(name.trim()) ? `Capítulo de ${date}` : name;
}

function toSeasons(meta: AddonMeta): Season[] {
  const bySeason = new Map<number, Episode[]>();
  (meta.videos ?? []).forEach((v) => {
    // temporada 0 são especiais e extras
    if (!v.season || !v.episode) return;
    const list = bySeason.get(v.season) ?? [];
    list.push({
      number: v.episode,
      title: episodeName(v),
      runtime: parseRuntime(v.runtime),
      thumbnail: v.thumbnail,
      overview: v.overview || undefined,
      released: v.released,
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
/** Nome que o catálogo inventa quando o episódio não tem título traduzido. */
const GENERIC_EPISODE = /^(epis[oó]dio|episode)\s*\d+$/i;

/**
 * Completa o catálogo traduzido com o mesmo título em outro idioma (mesmos ids
 * e numeração, vindos do TMDB): nome, duração e imagem de episódio que faltam,
 * e a sinopse vazia.
 */
export function fillFrom(meta: AddonMeta, other: AddonMeta | null): AddonMeta {
  if (!other) return meta;
  const byNumber: Record<string, NonNullable<AddonMeta['videos']>[number]> = {};
  (other.videos ?? []).forEach((v) => (byNumber[`${v.season}:${v.episode}`] = v));
  return {
    ...meta,
    description: meta.description || other.description,
    videos: (meta.videos ?? []).map((v) => {
      const o = byNumber[`${v.season}:${v.episode}`];
      if (!o) return v;
      const name = v.title || v.name || '';
      const otherName = o.title || o.name || '';
      return {
        ...v,
        title: (!name || GENERIC_EPISODE.test(name)) && otherName && !GENERIC_EPISODE.test(otherName) ? otherName : name,
        runtime: v.runtime || o.runtime,
        thumbnail: v.thumbnail || o.thumbnail,
        overview: v.overview || o.overview,
      };
    }),
  };
}

/** Falta algo que o outro idioma pode ter? */
function incomplete(meta: AddonMeta): boolean {
  if (!meta.description) return true;
  return (meta.videos ?? []).some((v) => {
    if (!v.season || !v.episode) return false;
    const name = v.title || v.name || '';
    return !name || GENERIC_EPISODE.test(name) || !v.thumbnail;
  });
}

export function createAddonProvider(base: string, localized: boolean, fallback?: string): CatalogProvider {
  const catalogs = () =>
    fetchManifest(base).then((m) =>
      (m.catalogs ?? []).filter(
        (c) =>
          (c.type === 'movie' || c.type === 'series') &&
          PARAMETERIZED_CATALOGS.indexOf(c.id) < 0 &&
          !(c.extra ?? []).some((e) => e.isRequired),
      ),
    );

  const meta = async (type: TitleType, id: string) => {
    // os dois ao mesmo tempo: o /meta leva segundos, e esperar um depois do outro dobraria
    const other = fallback ? fetchMeta(fallback, type, id).catch(() => null) : null;
    const m = await fetchMeta(base, type, id).catch(() => null);
    if (!m || !other || !incomplete(m)) return m;
    return fillFrom(m, await other);
  };

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
  const streamingBlock = (type: TitleType, id: string, skip: number) =>
    fetchCatalog(STREAMING.base, type, id, skip ? { skip: String(skip) } : undefined).then((metas) =>
      metas.map(toTitle).filter((t) => !!t.poster),
    );
  const plural = (type: TitleType) => (type === 'series' ? 'series' : 'movies');

  /**
   * País, nome e cartaz de cada novela no catálogo principal. A lista em
   * português não traz o país (para deixar as de Portugal de fora) e a do
   * Globoplay vem com nome e cartaz em inglês. Só o /meta tem isso, e ele é
   * pesado (todos os capítulos), então cada novela é consultada uma vez e o
   * resumo fica guardado no aparelho.
   */
  type NovelaInfo = Pick<AddonMeta, 'country' | 'name' | 'poster' | 'description'>;
  const novelaInfo = read<Record<string, NovelaInfo>>('novela-info', {});
  const infoOf = (id: string): Promise<NovelaInfo | null> =>
    id in novelaInfo
      ? Promise.resolve(novelaInfo[id])
      : getJson<{ meta?: AddonMeta }>(`${base}/meta/series/${encodeURIComponent(id)}.json`).then(
          (r) => {
            if (!r.meta) return null;
            const { country, name, poster, description } = r.meta;
            novelaInfo[id] = { country, name, poster, description };
            write('novela-info', novelaInfo);
            return novelaInfo[id];
          },
          () => null,
        );
  /** resumos de 4 em 4, para não afogar a TV */
  async function withInfo(metas: AddonMeta[]) {
    const out: { meta: AddonMeta; info: NovelaInfo | null }[] = [];
    for (let i = 0; i < metas.length; i += 4) {
      const chunk = metas.slice(i, i + 4);
      const found = await Promise.all(chunk.map((m) => infoOf(m.id)));
      chunk.forEach((meta, j) => out.push({ meta, info: found[j] }));
    }
    return out;
  }

  /**
   * Novelas brasileiras: as do Globoplay (as no ar primeiro, na ordem do addon)
   * e as clássicas do catálogo em português, embaralhadas a cada abertura.
   */
  let novelas: Promise<Title[]> | null = null;
  const loadNovelas = () => {
    if (!novelas) {
      const soap = (m: AddonMeta) => isSoap({ genres: m.genres ?? [] });
      const globoplay = fetchCatalog(STREAMING.base, 'series', GLOBOPLAY)
        .then((metas) => withInfo(metas.filter((m) => soap(m) && m.country === 'Brazil')))
        // nome, cartaz e sinopse em português no lugar dos do addon de streamings
        .then((list) => list.map(({ meta, info }) => ({ ...meta, ...(info ?? {}), language: 'pt' })))
        .catch(() => [] as AddonMeta[]);
      const classics = Promise.all(
        Array.from({ length: NOVELA_PAGES }, (_, i) =>
          fetchCatalog(base, 'series', 'series-by-language', {
            genre: 'Portuguese',
            ...(i ? { skip: String(i * PAGE_SIZE) } : {}),
          }).catch(() => [] as AddonMeta[]),
        ),
      )
        .then((pages) => withInfo(([] as AddonMeta[]).concat(...pages).filter(soap)))
        // sem resposta, fica: quase todas são brasileiras
        .then((list) => list.filter(({ info }) => !info?.country || info.country === 'BR').map(({ meta }) => ({ ...meta, language: 'pt' })));
      novelas = Promise.all([globoplay, classics]).then(([now, old]) => {
        const seen: Record<string, boolean> = {};
        const unique = (list: AddonMeta[]) =>
          list
            .map(toTitle)
            .filter((t) => !!t.poster && !seen[t.id] && (seen[t.id] = true));
        return remember(unique(now).concat(shuffled(unique(old), 'novelas')));
      });
      // falhou ou veio vazia: a próxima abertura tenta de novo
      novelas.then(
        (list) => list.length || (novelas = null),
        () => (novelas = null),
      );
    }
    return novelas;
  };

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
      const all = await catalogs();
      const list = all.filter((c) => (!filter || c.type === filter) && HIDDEN_CATALOGS.indexOf(c.id) < 0);
      const refs = list.map(
        (c): RowRef => ({
          id: `${c.type}:${c.id}`,
          title: (localized && CATALOG_NAMES_PT[c.id]) || c.name,
          style: 'poster',
          type: c.type as TitleType,
          catalogId: c.id,
          // a cada abertura, cada fileira começa numa página sorteada e embaralha os itens
          skip: TIMELY.indexOf(c.id) < 0 ? Math.floor(randomFor(`page:${c.id}`)() * PAGES) * PAGE_SIZE : 0,
          shuffle: true,
        }),
      );
      // Em alta no topo; depois as notas altas; o resto na ordem do addon (fixa).
      const pinned = PINNED.map((id) => refs.filter((r) => r.catalogId === id)[0]).filter(Boolean);
      const topRow: RowRef = {
        id: `top-rated:${filter ?? 'all'}`,
        title: 'Notas altas no IMDb',
        style: 'poster',
        type: filter,
        kind: 'top-rated',
        showRating: true,
      };
      const rest = refs.filter((r) => pinned.indexOf(r) < 0);
      if (!filter) return [...pinned, topRow, ...rest].map((r, i) => ({ ...r, style: i === 0 ? 'tall' : r.style }));

      // Filmes e Séries: mais streamings logo depois dos do addon, e uma fileira por gênero no fim.
      const name = filter === 'series' ? 'Séries' : 'Filmes';
      const streaming = STREAMING.services.map(
        (service): RowRef => ({
          id: `streaming:${filter}:${service.id}`,
          title: localized ? `${name} ${service.id === 'hbm' ? 'da' : 'do'} ${service.name}` : `${service.name} ${filter === 'series' ? 'series' : 'movies'}`,
          style: 'poster',
          type: filter,
          catalogId: service.id,
          kind: 'streaming',
          shuffle: true,
        }),
      );
      // novelas brasileiras logo depois dos streamings (só no catálogo em português, que tem o Globoplay)
      const novelaRow: RowRef[] =
        filter === 'series' && localized
          ? [{ id: 'novelas', title: 'Novelas', style: 'poster', type: 'series', kind: 'novelas' }]
          : [];
      const lastProvider = rest.map((r) => (r.catalogId ?? '').indexOf(STREAMING_AFTER) === 0).lastIndexOf(true);
      const at = lastProvider >= 0 ? lastProvider + 1 : rest.length;
      const popular = all.filter((c) => c.type === filter && c.id === `popular-${plural(filter)}`)[0];
      const options = (popular?.extra ?? []).filter((e) => e.name === 'genre')[0]?.options ?? [];
      const genres = options
        .filter((g) => GENRE_NAMES_PT[g])
        .map(
          (genre): RowRef => ({
            id: `genre:${filter}:${genre}`,
            title: localized ? GENRE_NAMES_PT[genre] : genre,
            style: 'poster',
            type: filter,
            catalogId: popular.id,
            genre,
            skip: Math.floor(randomFor(`page:${filter}:${genre}`)() * PAGES) * PAGE_SIZE,
            shuffle: true,
          }),
        );
      return [...pinned, topRow, ...rest.slice(0, at), ...streaming, ...novelaRow, ...rest.slice(at), ...genres].map((r, i) => ({
        ...r,
        style: i === 0 ? 'tall' : r.style,
      }));
    },

    async loadRow(ref, n = 0) {
      if (ref.kind === 'top-rated') return n ? [] : topRated(ref.type);
      if (ref.kind === 'novelas') return n ? [] : loadNovelas();
      if (!ref.type || !ref.catalogId) return [];
      if (ref.kind === 'streaming') {
        // em ordem de popularidade, 100 por vez: embaralha o bloco e entrega 20 por página
        const offset = n * PAGE_SIZE;
        const block = Math.floor(offset / STREAMING_BLOCK) * STREAMING_BLOCK;
        const items = await streamingBlock(ref.type, ref.catalogId, block);
        const mixed = shuffled(items, `items:${ref.id}:${block}`);
        return remember(mixed.slice(offset - block, offset - block + PAGE_SIZE));
      }
      const skip = (ref.skip ?? 0) + n * PAGE_SIZE;
      const extra: Record<string, string> = {};
      if (ref.genre) extra.genre = ref.genre;
      if (skip) extra.skip = String(skip);
      const items = remember((await fetchCatalog(base, ref.type, ref.catalogId, extra)).map(toTitle));
      return ref.shuffle ? shuffled(items, `items:${ref.id}:${n}`) : items;
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
      // novela brasileira: as outras novelas brasileiras
      const brazilian = localized && isSoap(title) ? await loadNovelas().catch(() => [] as Title[]) : [];
      // a prévia vinda de um card do Globoplay não sabe o idioma; estar na lista basta
      if (brazilian.length && (title.originalLanguage === 'pt' || brazilian.some((t) => t.id === title.id))) {
        const list = brazilian;
        return shuffled(
          list.filter((t) => t.id !== title.id),
          `similar:${title.id}`,
        ).slice(0, SIMILAR_LIMIT);
      }
      const popular = (await catalogs()).filter((c) => c.id === `popular-${title.type === 'series' ? 'series' : 'movies'}`)[0];
      const genres = (popular?.extra ?? []).filter((e) => e.name === 'genre')[0]?.options ?? [];
      // novela de fora (turca, mexicana…): outras novelas, não o drama que vier antes na lista
      const genre = isSoap(title) && genres.indexOf('Soap') >= 0 ? 'Soap' : title.genres.filter((g) => genres.indexOf(g) >= 0)[0];
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
