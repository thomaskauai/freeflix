// Catálogo dos streamings no Brasil, lido do JustWatch: completo, em português,
// já no formato de catálogo dos addons ({ metas }). Os streamings que o catálogo
// principal (Nuvio) não tem vêm daqui.
//   GET ?list=series&service=&page= -> séries do streaming, 20 por página
//   GET ?list=movies&service=&page= -> filmes do streaming, 20 por página
//   GET ?list=novelas      -> novelas brasileiras do Globoplay (todas, das mais vistas para as menos)
//   GET ?list=series-br    -> séries brasileiras do Globoplay que não são novela (todas)
//   GET ?list=movies-br&page= -> filmes brasileiros do Globoplay, 20 por página
//   GET ?list=anime-ids    -> ids IMDb de todos os animes (séries e filmes), para o app esconder
//   GET ?list=cinema-ids   -> ids IMDb dos filmes que só passam no cinema, para o app esconder
// service: mxx (HBO Max), atp (Apple TV+), pmp (Paramount+), gop (Globoplay, o padrão), cru (Crunchyroll).
// A API do JustWatch só libera CORS para localhost; o servidor busca por elas.
import { json, preflight } from './_lib.js';

export const OPTIONS = preflight;

const JUSTWATCH = 'https://apis.justwatch.com/graphql';
const IMAGES = 'https://images.justwatch.com';
/** códigos de streaming do JustWatch aceitos em ?service= */
const SERVICES = ['mxx', 'atp', 'pmp', 'gop', 'cru'];
const GLOBOPLAY = 'gop';
const PAGE_SIZE = 20;
/** o JustWatch entrega no máximo 100 por pedido */
const BATCH = 100;
/** novela: uma temporada longa; série brasileira tem temporadas curtas */
const NOVELA_MIN_EPISODES = 60;
const NOT_NOVELA = ['rly', 'doc', 'ani'];

// gêneros do JustWatch com os nomes do TMDB, que o app traduz e usa nos semelhantes
const GENRES: Record<string, { movie: string; series: string }> = {
  act: { movie: 'Action', series: 'Action & Adventure' },
  ani: { movie: 'Animation', series: 'Animation' },
  cmy: { movie: 'Comedy', series: 'Comedy' },
  crm: { movie: 'Crime', series: 'Crime' },
  doc: { movie: 'Documentary', series: 'Documentary' },
  drm: { movie: 'Drama', series: 'Drama' },
  fml: { movie: 'Family', series: 'Family' },
  fnt: { movie: 'Fantasy', series: 'Sci-Fi & Fantasy' },
  hrr: { movie: 'Horror', series: 'Horror' },
  hst: { movie: 'History', series: 'History' },
  msc: { movie: 'Music', series: 'Music' },
  rly: { movie: 'Reality', series: 'Reality' },
  rma: { movie: 'Romance', series: 'Romance' },
  scf: { movie: 'Science Fiction', series: 'Sci-Fi & Fantasy' },
  trl: { movie: 'Thriller', series: 'Mystery' },
  war: { movie: 'War', series: 'War & Politics' },
  wsn: { movie: 'Western', series: 'Western' },
};

const QUERY = `query Globoplay($first: Int!, $after: String, $filter: TitleFilter) {
  popularTitles(country: BR, first: $first, after: $after, filter: $filter, sortBy: POPULAR) {
    edges { node {
      objectType
      ... on Show { totalSeasonCount seasons { totalEpisodeCount } }
      content(country: BR, language: "pt") {
        title originalTitle originalReleaseYear shortDescription posterUrl
        backdrops { backdropUrl }
        genres { shortName }
        externalIds { imdbId }
      }
      brazilian: content(country: BR, language: "pt-BR") { title shortDescription }
    } }
  }
}`;

interface Node {
  objectType: 'SHOW' | 'MOVIE';
  totalSeasonCount?: number;
  seasons?: { totalEpisodeCount: number | null }[];
  content: {
    title: string;
    originalTitle: string | null;
    originalReleaseYear: number | null;
    shortDescription: string | null;
    posterUrl: string | null;
    backdrops: { backdropUrl: string }[];
    genres: { shortName: string }[];
    externalIds: { imdbId: string | null };
  };
  /**
   * "pt" mistura o português de Portugal ("Vai Seguir-te", "pede-a em
   * casamento"); "pt-BR" traduz para o inglês o nome das produções brasileiras
   * ("Brazil Avenue").
   */
  brazilian?: { title: string | null; shortDescription: string | null };
}

/**
 * Anime: animação do Japão, da China ou da Coreia, sem os EUA na produção
 * (Super Mario e Batman coproduzidos lá são de fora; Cyberpunk, Japão e
 * Polônia, é anime). O JustWatch não passa de ~1900 por filtro, então as
 * séries vêm fatiadas por ano.
 */
const ANIME_COUNTRIES = ['JP', 'CN', 'KR', 'TW'];
const ANIME_SLICES: { kind: 'SHOW' | 'MOVIE'; years?: { min?: number; max?: number } }[] = [
  { kind: 'SHOW', years: { max: 2009 } },
  { kind: 'SHOW', years: { min: 2010, max: 2017 } },
  { kind: 'SHOW', years: { min: 2018, max: 2021 } },
  { kind: 'SHOW', years: { min: 2022 } },
  { kind: 'MOVIE' },
];
const ANIME_QUERY = `query Anime($first: Int!, $after: String, $filter: TitleFilter) {
  popularTitles(country: BR, first: $first, after: $after, filter: $filter) {
    edges { node { content(country: BR, language: "pt") { productionCountries externalIds { imdbId } } } }
  }
}`;

interface AnimeNode {
  content: { productionCountries: string[] | null; externalIds: { imdbId: string | null } };
}

async function animePage(slice: (typeof ANIME_SLICES)[number], offset: number): Promise<AnimeNode[]> {
  const filter = {
    objectTypes: [slice.kind],
    genres: ['ani'],
    productionCountries: ANIME_COUNTRIES,
    ...(slice.years ? { releaseYear: slice.years } : {}),
  };
  const after = offset ? Buffer.from(String(offset)).toString('base64') : '';
  const res = await fetch(JUSTWATCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: ANIME_QUERY, variables: { first: BATCH, after, filter } }),
  });
  if (!res.ok) throw new Error(`justwatch ${res.status}`);
  const body = (await res.json()) as { data?: { popularTitles: { edges: { node: AnimeNode }[] } } };
  return body.data ? body.data.popularTitles.edges.map((e) => e.node) : [];
}

/** Todos os animes: cada fatia em pedidos de 100, quatro por vez, até acabar. */
async function animeIds(): Promise<string[]> {
  const ids: Record<string, boolean> = {};
  await Promise.all(
    ANIME_SLICES.map(async (slice) => {
      for (let start = 0; start < 2000; start += 4 * BATCH) {
        const chunk = await Promise.all([0, 1, 2, 3].map((i) => animePage(slice, start + i * BATCH)));
        chunk.forEach((nodes) =>
          nodes.forEach((n) => {
            const id = n.content.externalIds.imdbId;
            if (id && (n.content.productionCountries ?? []).indexOf('US') < 0) ids[id] = true;
          }),
        );
        if (chunk[chunk.length - 1].length < BATCH) break;
      }
    }),
  );
  return Object.keys(ids);
}

const CINEMA_QUERY = `query Cinema($first: Int!, $after: String, $filter: TitleFilter) {
  popularTitles(country: BR, first: $first, after: $after, filter: $filter) {
    edges { node {
      content(country: BR, language: "pt") { externalIds { imdbId } }
      offers(country: BR, platform: WEB) { monetizationType }
    } }
  }
}`;

interface CinemaNode {
  content: { externalIds: { imdbId: string | null } };
  offers: { monetizationType: string }[];
}

/**
 * Filmes em cartaz no Brasil sem nenhuma outra oferta (assinatura, aluguel,
 * compra, grátis): o que existe deles é gravação de cinema.
 */
async function cinemaIds(): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; offset < 2000; offset += BATCH) {
    const after = offset ? Buffer.from(String(offset)).toString('base64') : '';
    const res = await fetch(JUSTWATCH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: CINEMA_QUERY,
        variables: { first: BATCH, after, filter: { objectTypes: ['MOVIE'], monetizationTypes: ['CINEMA'] } },
      }),
    });
    if (!res.ok) throw new Error(`justwatch ${res.status}`);
    const body = (await res.json()) as { data?: { popularTitles: { edges: { node: CinemaNode }[] } } };
    const nodes = body.data ? body.data.popularTitles.edges.map((e) => e.node) : [];
    nodes.forEach((n) => {
      const id = n.content.externalIds.imdbId;
      const onlyCinema = n.offers.length > 0 && n.offers.every((o) => o.monetizationType === 'CINEMA');
      if (id && onlyCinema) ids.push(id);
    });
    if (nodes.length < BATCH) break;
  }
  return ids;
}

const image = (path: string | null | undefined, profile: string) =>
  path ? IMAGES + path.replace('{profile}', profile).replace('{format}', 'jpg') : undefined;

/** O cursor do JustWatch é a posição em base64: dá para pedir qualquer página. */
async function batch(
  kind: 'SHOW' | 'MOVIE',
  offset: number,
  first: number,
  brazilian: boolean,
  service = GLOBOPLAY,
): Promise<Node[]> {
  const filter = { packages: [service], objectTypes: [kind], ...(brazilian ? { productionCountries: ['BR'] } : {}) };
  const after = offset ? Buffer.from(String(offset)).toString('base64') : '';
  const res = await fetch(JUSTWATCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { first, after, filter } }),
  });
  if (!res.ok) throw new Error(`justwatch ${res.status}`);
  const body = (await res.json()) as { data?: { popularTitles: { edges: { node: Node }[] } } };
  return body.data ? body.data.popularTitles.edges.map((e) => e.node) : [];
}

/** Todas as séries brasileiras do Globoplay (umas 700): poucos pedidos de 100 ao mesmo tempo. */
async function allBrazilianShows(): Promise<Node[]> {
  const pages: Node[][] = [];
  for (let start = 0; ; start += 4 * BATCH) {
    const chunk = await Promise.all([0, 1, 2, 3].map((i) => batch('SHOW', start + i * BATCH, BATCH, true)));
    pages.push(...chunk);
    if (chunk[chunk.length - 1].length < BATCH) break;
  }
  return pages.flat();
}

function isNovela(node: Node): boolean {
  const episodes = (node.seasons ?? []).reduce((n, s) => n + (s.totalEpisodeCount ?? 0), 0);
  const genres = node.content.genres.map((g) => g.shortName);
  return node.totalSeasonCount === 1 && episodes >= NOVELA_MIN_EPISODES && !genres.some((g) => NOT_NOVELA.includes(g));
}

/** No formato de item de catálogo dos addons; sem id IMDb as fontes de vídeo não acham, então fica de fora. */
function toMeta(node: Node, brazilian: boolean) {
  const c = node.content;
  if (!c.externalIds.imdbId) return null;
  const type = node.objectType === 'SHOW' ? 'series' : 'movie';
  const genres = c.genres
    .map((g) => GENRES[g.shortName]?.[type])
    .filter((g, i, all): g is string => !!g && all.indexOf(g) === i);
  return {
    id: c.externalIds.imdbId,
    type,
    name: nameOf(node),
    poster: image(c.posterUrl, 's332'),
    background: image(c.backdrops[0]?.backdropUrl, 's1440'),
    description: node.brazilian?.shortDescription || c.shortDescription || undefined,
    releaseInfo: c.originalReleaseYear ? String(c.originalReleaseYear) : undefined,
    genres: type === 'series' && isNovela(node) ? ['Soap', ...genres] : genres,
    ...(brazilian ? { country: 'BR', language: 'pt' } : {}),
  };
}

/** Produção brasileira fica com o nome original; estrangeira, com o nome lançado no Brasil. */
function nameOf(node: Node): string {
  const pt = node.content.title.trim();
  const original = (node.content.originalTitle ?? '').trim();
  return pt === original ? pt : node.brazilian?.title?.trim() || pt;
}

const metas = (nodes: Node[], brazilian: boolean) => nodes.map((n) => toMeta(n, brazilian)).filter(Boolean);

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const list = params.get('list');
  const page = Math.max(0, Math.min(200, Number(params.get('page')) || 0));
  const service = params.get('service') || GLOBOPLAY;
  if (SERVICES.indexOf(service) < 0) return json({ error: 'bad-request' }, 400);
  try {
    let nodes: Node[];
    let brazilian = true;
    if (list === 'anime-ids') {
      // muda devagar: um dia no CDN, e mais uma semana servindo a antiga enquanto renova
      return json({ ids: await animeIds() }, 200, {
        'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
      });
    }
    if (list === 'cinema-ids') {
      // sai do cinema para o streaming de um dia para o outro: seis horas no CDN
      return json({ ids: await cinemaIds() }, 200, {
        'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400',
      });
    }
    if (list === 'novelas' || list === 'series-br') {
      const shows = await allBrazilianShows();
      nodes = shows.filter((n) => isNovela(n) === (list === 'novelas'));
    } else if (list === 'series' || list === 'movies' || list === 'movies-br') {
      brazilian = list === 'movies-br';
      // séries e filmes: de qualquer streaming; os brasileiros, só do Globoplay
      nodes = await batch(list === 'series' ? 'SHOW' : 'MOVIE', page * PAGE_SIZE, PAGE_SIZE, brazilian, brazilian ? GLOBOPLAY : service);
    } else {
      return json({ error: 'bad-request' }, 400);
    }
    // o catálogo muda devagar: seis horas no CDN, e mais um dia servindo o antigo enquanto renova
    return json({ metas: metas(nodes, brazilian) }, 200, {
      'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400',
    });
  } catch {
    return json({ error: 'upstream' }, 502);
  }
}
