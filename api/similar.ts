// Parecidos com um título, pelas recomendações do TMDB (fileira "Porque você
// assistiu" da Home). Mesmo formato das listas do catálogo (metas).
//   GET ?type=movie|series&id=tt…|tmdb:…&lang=pt-BR|en-US -> { metas: [...] }
// Ids em IMDb (tt…), como os do catálogo; tmdb:id quando o título não tem IMDb.
// Gêneros com os nomes em inglês do TMDB, como o catálogo manda.
// Chave do TMDB em TMDB_API_KEY (a chave v3 ou o token de leitura v4).
import { json, preflight } from './_lib.js';

export const OPTIONS = preflight;

const API = 'https://api.themoviedb.org/3';
const IMAGE = 'https://image.tmdb.org/t/p';
/** com menos que isso nas recomendações, completa com os "similares" do TMDB */
const MIN_RESULTS = 12;
const MAX_RESULTS = 20;
const ID = /^(tt\d{1,10}|tmdb:\d{1,10})$/;
const LANGS = ['pt-BR', 'en-US'];

const key = process.env.TMDB_API_KEY || '';

async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(API + path);
  Object.keys(params).forEach((k) => url.searchParams.set(k, params[k]));
  // token v4 (JWT, começa com "eyJ") vai no cabeçalho; chave v3, no endereço
  const bearer = key.indexOf('eyJ') === 0;
  if (!bearer) url.searchParams.set('api_key', key);
  const res = await fetch(url, bearer ? { headers: { Authorization: `Bearer ${key}` } } : undefined);
  if (!res.ok) throw new Error(`tmdb ${res.status} ${path}`);
  return (await res.json()) as T;
}

type Kind = 'movie' | 'tv';

interface Result {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  original_language?: string;
  release_date?: string;
  first_air_date?: string;
  adult?: boolean;
}

/** nomes dos gêneros em inglês, por id (mudam quase nunca: um por instância) */
const genreNames: Partial<Record<Kind, Promise<Record<number, string>>>> = {};
function genresOf(kind: Kind) {
  if (!genreNames[kind]) {
    genreNames[kind] = tmdb<{ genres?: { id: number; name: string }[] }>(`/genre/${kind}/list`, { language: 'en-US' }).then(
      (r) => {
        const out: Record<number, string> = {};
        (r.genres ?? []).forEach((g) => (out[g.id] = g.name));
        return out;
      },
    );
    genreNames[kind]!.catch(() => delete genreNames[kind]);
  }
  return genreNames[kind]!;
}

async function tmdbId(kind: Kind, id: string): Promise<number | null> {
  if (id.indexOf('tmdb:') === 0) return Number(id.slice(5));
  const found = await tmdb<{ movie_results?: { id: number }[]; tv_results?: { id: number }[] }>(`/find/${id}`, {
    external_source: 'imdb_id',
  });
  const list = (kind === 'tv' ? found.tv_results : found.movie_results) ?? [];
  return list.length ? list[0].id : null;
}

const results = (kind: Kind, id: number, list: 'recommendations' | 'similar', language: string) =>
  tmdb<{ results?: Result[] }>(`/${kind}/${id}/${list}`, { language, page: '1' }).then(
    (r) => r.results ?? [],
    () => [] as Result[],
  );

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const type = params.get('type');
  const id = params.get('id') ?? '';
  const language = LANGS.indexOf(params.get('lang') ?? '') >= 0 ? (params.get('lang') as string) : 'pt-BR';
  if ((type !== 'movie' && type !== 'series') || !ID.test(id)) return json({ error: 'bad-request' }, 400);
  if (!key) return json({ error: 'upstream' }, 502);
  const kind: Kind = type === 'series' ? 'tv' : 'movie';
  try {
    const tid = await tmdbId(kind, id);
    if (!tid) return json({ metas: [] }, 200, { 'Cache-Control': 'public, s-maxage=86400' });
    const [genres, recommended] = await Promise.all([genresOf(kind), results(kind, tid, 'recommendations', language)]);
    let list = recommended;
    if (list.length < MIN_RESULTS) list = list.concat(await results(kind, tid, 'similar', language));
    const seen: Record<number, boolean> = { [tid]: true };
    list = list.filter((r) => !r.adult && r.poster_path && !seen[r.id] && (seen[r.id] = true)).slice(0, MAX_RESULTS);
    const imdb = await Promise.all(
      list.map((r) =>
        tmdb<{ imdb_id?: string | null }>(`/${kind}/${r.id}/external_ids`).then(
          (x) => x.imdb_id || `tmdb:${r.id}`,
          () => `tmdb:${r.id}`,
        ),
      ),
    );
    const metas = list.map((r, i) => {
      const date = r.release_date || r.first_air_date || '';
      return {
        id: imdb[i],
        type,
        name: r.title || r.name || '',
        poster: `${IMAGE}/w500${r.poster_path}`,
        background: r.backdrop_path ? `${IMAGE}/w1280${r.backdrop_path}` : undefined,
        description: r.overview || undefined,
        genres: (r.genre_ids ?? []).map((g) => genres[g]).filter(Boolean),
        language: r.original_language || undefined,
        releaseInfo: date.slice(0, 4) || undefined,
      };
    });
    // recomendações mudam devagar: um dia no CDN, e mais uma semana servindo a antiga enquanto renova
    return json({ metas }, 200, { 'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800' });
  } catch (e) {
    console.error('similar', e instanceof Error ? e.message : e);
    return json({ error: 'upstream' }, 502);
  }
}
