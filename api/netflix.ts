// Originais da Netflix, pelo TMDB: séries da emissora Netflix e filmes das
// produtoras Netflix e Netflix Animation Studios, os mais populares de cada.
// O catálogo (Nuvio) não diz de onde o título é; com esta lista o app põe o N
// nos cards sem consultar título por título.
//   GET -> { ids: ["tt…", "tmdb:…", …] }   (IMDb; tmdb:id quando não tem IMDb)
// Chave do TMDB em TMDB_API_KEY (a chave v3 ou o token de leitura v4).
import { json, preflight } from "./_lib.js";

export const OPTIONS = preflight;

const API = "https://api.themoviedb.org/3";
/** emissora Netflix (séries) */
const NETFLIX_NETWORK = 213;
/** produtoras Netflix e Netflix Animation Studios (filmes) */
const NETFLIX_COMPANIES = "178464|171251";
/** 20 por página: 500 séries e 300 filmes mais populares */
const SERIES_PAGES = 25;
const MOVIE_PAGES = 15;
/** pedidos ao TMDB ao mesmo tempo (o limite deles é ~50 por segundo) */
const PARALLEL = 20;

const key = process.env.TMDB_API_KEY || "";

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(API + path);
  Object.keys(params).forEach((k) => url.searchParams.set(k, params[k]));
  // token v4 (JWT, começa com "eyJ") vai no cabeçalho; chave v3, no endereço
  const bearer = key.indexOf("eyJ") === 0;
  if (!bearer) url.searchParams.set("api_key", key);
  const res = await fetch(url, bearer ? { headers: { Authorization: `Bearer ${key}` } } : undefined);
  if (!res.ok) throw new Error(`tmdb ${res.status} ${path}`);
  return (await res.json()) as T;
}

/** em lotes de PARALLEL, na ordem */
async function inBatches<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += PARALLEL) {
    out.push(...(await Promise.all(items.slice(i, i + PARALLEL).map(run))));
  }
  return out;
}

async function discover(kind: "tv" | "movie", pages: number): Promise<number[]> {
  const filter: Record<string, string> =
    kind === "tv" ? { with_networks: String(NETFLIX_NETWORK) } : { with_companies: NETFLIX_COMPANIES };
  const results = await inBatches(
    Array.from({ length: pages }, (_, i) => i + 1),
    (page) =>
      tmdb<{ results?: { id: number }[] }>(`/discover/${kind}`, {
        ...filter,
        sort_by: "popularity.desc",
        page: String(page),
      }).then((r) => (r.results ?? []).map((x) => x.id), () => [] as number[]),
  );
  return ([] as number[]).concat(...results);
}

async function netflixIds(): Promise<string[]> {
  if (!key) throw new Error("TMDB_API_KEY não configurada");
  const [series, movies] = await Promise.all([discover("tv", SERIES_PAGES), discover("movie", MOVIE_PAGES)]);
  const lookups = series
    .map((id) => ({ kind: "tv", id }))
    .concat(movies.map((id) => ({ kind: "movie", id })));
  const ids = await inBatches(lookups, ({ kind, id }) =>
    tmdb<{ imdb_id?: string | null }>(`/${kind}/${id}/external_ids`).then(
      (r) => r.imdb_id || `tmdb:${id}`,
      () => `tmdb:${id}`,
    ),
  );
  if (!ids.length) throw new Error("lista vazia");
  return Array.from(new Set(ids));
}

/** última lista boa nesta instância: TMDB fora do ar não tira o N do app */
let good: string[] | null = null;

export async function GET() {
  try {
    good = await netflixIds();
  } catch (e) {
    console.error("netflix", e instanceof Error ? e.message : e);
    if (!good) return json({ error: "upstream" }, 502);
  }
  // muda devagar: um dia no CDN, e mais uma semana servindo a antiga enquanto renova
  return json({ ids: good }, 200, {
    "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
  });
}
