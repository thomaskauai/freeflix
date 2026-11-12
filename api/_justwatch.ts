// Listas dos streamings no Brasil, lidas do JustWatch. Usado pela função do
// site (api/justwatch.ts) e, quando o JustWatch recusa o servidor do site
// (429), pelo app da TV direto (src/data/addonProvider.ts): a TV não tem a
// barreira de CORS e sai pela internet de casa. Arquivo com "_" não vira rota.
// Só fetch, setTimeout e btoa: roda no Node e no navegador.

export const JUSTWATCH = "https://apis.justwatch.com/graphql";
const IMAGES = "https://images.justwatch.com";
/** códigos de streaming do JustWatch aceitos em ?service= */
export const SERVICES = ["nfx", "mxx", "atp", "pmp", "gop", "cru"];
export const GLOBOPLAY = "gop";

/**
 * Pedido ao JustWatch. Ele responde 429 quando recebe pedidos demais do mesmo
 * servidor: espera um pouco (o Retry-After, se vier) e tenta de novo, até 3 vezes.
 */
export async function ask(body: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(JUSTWATCH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    if (res.ok) return res;
    if (res.status !== 429 || attempt >= 3)
      throw new Error(`justwatch ${res.status}`);
    const wait = Number(res.headers.get("retry-after"));
    await new Promise((r) =>
      setTimeout(r, wait > 0 && wait <= 10 ? wait * 1000 : 1000 * 2 ** attempt),
    );
  }
}
const PAGE_SIZE = 20;
/** o JustWatch entrega no máximo 100 por pedido */
export const BATCH = 100;
/** novela: uma temporada longa; série brasileira tem temporadas curtas */
const NOVELA_MIN_EPISODES = 60;
const NOT_NOVELA = ["rly", "doc", "ani"];

// gêneros do JustWatch com os nomes do TMDB, que o app traduz e usa nos semelhantes
const GENRES: Record<string, { movie: string; series: string }> = {
  act: { movie: "Action", series: "Action & Adventure" },
  ani: { movie: "Animation", series: "Animation" },
  cmy: { movie: "Comedy", series: "Comedy" },
  crm: { movie: "Crime", series: "Crime" },
  doc: { movie: "Documentary", series: "Documentary" },
  drm: { movie: "Drama", series: "Drama" },
  fml: { movie: "Family", series: "Family" },
  fnt: { movie: "Fantasy", series: "Sci-Fi & Fantasy" },
  hrr: { movie: "Horror", series: "Horror" },
  hst: { movie: "History", series: "History" },
  msc: { movie: "Music", series: "Music" },
  rly: { movie: "Reality", series: "Reality" },
  rma: { movie: "Romance", series: "Romance" },
  scf: { movie: "Science Fiction", series: "Sci-Fi & Fantasy" },
  trl: { movie: "Thriller", series: "Mystery" },
  war: { movie: "War", series: "War & Politics" },
  wsn: { movie: "Western", series: "Western" },
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
  objectType: "SHOW" | "MOVIE";
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

const image = (path: string | null | undefined, profile: string) =>
  path
    ? IMAGES + path.replace("{profile}", profile).replace("{format}", "jpg")
    : undefined;

/** O cursor do JustWatch é a posição em base64: dá para pedir qualquer página. */
async function batch(
  kind: "SHOW" | "MOVIE",
  offset: number,
  first: number,
  brazilian: boolean,
  service = GLOBOPLAY,
): Promise<Node[]> {
  const filter = {
    packages: [service],
    objectTypes: [kind],
    ...(brazilian ? { productionCountries: ["BR"] } : {}),
  };
  const after = offset ? cursor(offset) : "";
  const res = await ask(
    JSON.stringify({ query: QUERY, variables: { first, after, filter } }),
  );
  const body = (await res.json()) as {
    data?: { popularTitles: { edges: { node: Node }[] } };
  };
  return body.data ? body.data.popularTitles.edges.map((e) => e.node) : [];
}

/** Todas as séries brasileiras do Globoplay (umas 700): poucos pedidos de 100 ao mesmo tempo. */
async function allBrazilianShows(): Promise<Node[]> {
  const pages: Node[][] = [];
  for (let start = 0; ; start += 4 * BATCH) {
    const chunk = await Promise.all(
      [0, 1, 2, 3].map((i) => batch("SHOW", start + i * BATCH, BATCH, true)),
    );
    pages.push(...chunk);
    if (chunk[chunk.length - 1].length < BATCH) break;
  }
  return pages.flat();
}

function isNovela(node: Node): boolean {
  const episodes = (node.seasons ?? []).reduce(
    (n, s) => n + (s.totalEpisodeCount ?? 0),
    0,
  );
  const genres = node.content.genres.map((g) => g.shortName);
  return (
    node.totalSeasonCount === 1 &&
    episodes >= NOVELA_MIN_EPISODES &&
    !genres.some((g) => NOT_NOVELA.includes(g))
  );
}

/** No formato de item de catálogo dos addons; sem id IMDb as fontes de vídeo não acham, então fica de fora. */
function toMeta(node: Node, brazilian: boolean) {
  const c = node.content;
  if (!c.externalIds.imdbId) return null;
  const type = node.objectType === "SHOW" ? "series" : "movie";
  const genres = c.genres
    .map((g) => GENRES[g.shortName]?.[type])
    .filter((g, i, all): g is string => !!g && all.indexOf(g) === i);
  return {
    id: c.externalIds.imdbId,
    type,
    name: nameOf(node),
    poster: image(c.posterUrl, "s332"),
    background: image(c.backdrops[0]?.backdropUrl, "s1440"),
    description:
      node.brazilian?.shortDescription || c.shortDescription || undefined,
    releaseInfo: c.originalReleaseYear
      ? String(c.originalReleaseYear)
      : undefined,
    genres: type === "series" && isNovela(node) ? ["Soap", ...genres] : genres,
    ...(brazilian ? { country: "BR", language: "pt" } : {}),
  };
}

/** Produção brasileira fica com o nome original; estrangeira, com o nome lançado no Brasil. */
function nameOf(node: Node): string {
  const pt = node.content.title.trim();
  const original = (node.content.originalTitle ?? "").trim();
  return pt === original ? pt : node.brazilian?.title?.trim() || pt;
}

const metas = (nodes: Node[], brazilian: boolean) =>
  nodes.map((n) => toMeta(n, brazilian)).filter(Boolean);


/** posição em base64, o cursor do JustWatch */
export const cursor = (offset: number) => btoa(String(offset));

/**
 * Uma lista no formato de catálogo dos addons: "series"/"movies" do streaming
 * (20 por página), "movies-br" (Globoplay, 20 por página), "novelas" e
 * "series-br" (Globoplay, inteiras). Lista desconhecida: null.
 */
export async function listMetas(list: string, service = GLOBOPLAY, page = 0) {
  if (list === "novelas" || list === "series-br") {
    const shows = await allBrazilianShows();
    return metas(shows.filter((n) => isNovela(n) === (list === "novelas")), true);
  }
  if (list === "series" || list === "movies" || list === "movies-br") {
    const brazilian = list === "movies-br";
    // séries e filmes: de qualquer streaming; os brasileiros, só do Globoplay
    const nodes = await batch(
      list === "series" ? "SHOW" : "MOVIE",
      page * PAGE_SIZE,
      PAGE_SIZE,
      brazilian,
      brazilian ? GLOBOPLAY : service,
    );
    return metas(nodes, brazilian);
  }
  return null;
}
