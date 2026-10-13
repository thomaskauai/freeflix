import type { CatalogProvider, Row, Season, Title } from './types';

// Stub para um catálogo remoto. Espera uma API que já devolva os formatos de
// ./types.ts nestes caminhos; se a API real for diferente, normalize aqui e a
// UI não muda.
//   GET /featured                -> Title
//   GET /rows?filter=            -> Row[]
//   GET /titles/:id              -> Title
//   GET /titles?ids=a,b          -> Title[]
//   GET /titles/:id/seasons      -> Season[]
//   GET /titles/:id/similar      -> Title[]
//   GET /search?q=               -> Title[]
export function createHttpProvider(baseUrl: string): CatalogProvider {
  const base = baseUrl.replace(/\/$/, '');

  async function get<T>(path: string): Promise<T> {
    const res = await fetch(base + path);
    if (!res.ok) throw new Error(`Catálogo respondeu ${res.status} em ${path}`);
    return res.json() as Promise<T>;
  }

  return {
    getFeatured: () => get<Title>('/featured'),
    getRows: (filter) => get<Row[]>(`/rows${filter ? `?filter=${filter}` : ''}`),
    getTitle: (id) => get<Title | null>(`/titles/${encodeURIComponent(id)}`),
    getTitles: (ids) =>
      ids.length ? get<Title[]>(`/titles?ids=${ids.map(encodeURIComponent).join(',')}`) : Promise.resolve([]),
    getSeasons: (id) => get<Season[]>(`/titles/${encodeURIComponent(id)}/seasons`),
    getSimilar: (id) => get<Title[]>(`/titles/${encodeURIComponent(id)}/similar`),
    search: (q) => get<Title[]>(`/search?q=${encodeURIComponent(q)}`),
  };
}
