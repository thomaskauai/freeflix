import data from './catalog.json';
import type { CatalogProvider, RowRef, RowStyle, Season, Title, TitleType, VideoSource } from './types';

interface Row extends RowRef {
  items: Title[];
}

interface RawTitle {
  id: string;
  type: TitleType;
  tmdbId?: number | null;
  title: string;
  originalTitle: string;
  year: number;
  runtime: number;
  genres: string[];
  tagline: string;
  synopsis: string;
  poster?: string;
  backdrop?: string;
  isNew?: boolean;
  videos?: VideoSource[];
  /** episódios por temporada */
  seasons?: number[];
}

interface RawCatalog {
  featured: string;
  rows: { id: string; title: string; style: RowStyle; ids: string[] }[];
  titles: RawTitle[];
}

const raw = data as unknown as RawCatalog;

/** fileira com menos cards que isso parece quebrada numa tela de TV */
const MIN_ROW = 3;

const toTitle = (r: RawTitle): Title => ({
  id: r.id,
  type: r.type,
  tmdbId: r.tmdbId ?? null,
  title: r.title,
  originalTitle: r.originalTitle,
  year: r.year,
  runtime: r.runtime,
  genres: r.genres,
  tagline: r.tagline,
  synopsis: r.synopsis,
  poster: r.poster,
  backdrop: r.backdrop,
  isNew: r.isNew,
  publicDomain: true,
  videos: r.videos,
  seasonCount: r.seasons ? r.seasons.length : 0,
  episodeCount: r.seasons
    ? hasEmbed
      ? r.seasons.reduce((a, b) => a + b, 0)
      : (r.videos ?? []).filter((v) => v.episode != null).length
    : 0,
});

// Sem embed configurado, só entra no catálogo o que tem arquivo de vídeo:
// título que não toca não aparece.
const hasEmbed = !!(import.meta.env.VITE_EMBED_BASE_URL as string | undefined);
const playable = (r: RawTitle) => hasEmbed || (!!r.videos && r.videos.length > 0);

const titles = raw.titles.filter(playable).map(toTitle);
const byId = new Map(titles.map((t) => [t.id, t]));
const rawById = new Map(raw.titles.map((t) => [t.id, t]));

const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((t): t is Title => !!t);

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const allRows = (): Row[] =>
  raw.rows
    .map((r) => ({ id: r.id, title: r.title, style: r.style, items: pick(r.ids) }))
    .filter((r) => r.items.length >= MIN_ROW);

const TALL_ROW = 5;

/**
 * Seção de um tipo só: destaque em cards altos e depois uma fileira por
 * gênero. Filtrar as fileiras da Home deixaria várias com um ou dois cards.
 */
function rowsForType(type: TitleType, homeRows: Row[]): Row[] {
  const ofType = titles.filter((t) => t.type === type);
  const trending = (homeRows.filter((r) => r.id === 'trending')[0]?.items ?? []).filter((t) => t.type === type);
  const featured = trending.length >= TALL_ROW ? trending : ofType.slice(0, 12);

  const byGenre = new Map<string, Title[]>();
  ofType.forEach((t) =>
    t.genres.forEach((g) => {
      const list = byGenre.get(g) ?? [];
      list.push(t);
      byGenre.set(g, list);
    }),
  );
  const genreRows = Array.from(byGenre.entries())
    .filter(([, items]) => items.length >= MIN_ROW)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([genre, items]): Row => ({ id: `genre:${genre}`, title: genre, style: 'poster', items }));

  return [{ id: `featured:${type}`, title: 'Em alta', style: 'tall', items: featured }, ...genreRows];
}

function rowsFor(filter?: 'movie' | 'series' | 'new'): Row[] {
  const rows = allRows();
  if (!filter) return rows;
  if (filter === 'new') {
    return [
      {
        id: 'new',
        title: 'Chegaram agora',
        style: 'tall',
        // marcados como novidade primeiro; completa com os mais recentes do catálogo
        items: titles
          .slice()
          .sort((x, y) => Number(!!y.isNew) - Number(!!x.isNew) || (y.year ?? 0) - (x.year ?? 0))
          .slice(0, 8),
      },
      ...rows.filter((r) => r.id === 'popular'),
    ];
  }
  return rowsForType(filter, rows);
}

// loadRow recebe só o descritor; os itens ficam guardados pelo id da fileira.
const rowItems = new Map<string, Title[]>();

/** Catálogo embutido: clássicos em domínio público, com vídeo do Wikimedia Commons. */
export const localProvider: CatalogProvider = {
  async getFeatured() {
    return byId.get(raw.featured) ?? titles[0] ?? null;
  },

  async listRows(filter) {
    return rowsFor(filter).map((row) => {
      rowItems.set(row.id, row.items);
      return { id: row.id, title: row.title, style: row.style };
    });
  },

  async loadRow(ref) {
    return rowItems.get(ref.id) ?? [];
  },

  async getTitle(_type, id) {
    return byId.get(id) ?? null;
  },

  async getSeasons(_type, id) {
    const r = byId.has(id) ? rawById.get(id) : undefined;
    if (!r || !r.seasons) return [];
    // Mesma regra dos títulos: sem embed, só os episódios que têm arquivo.
    const hasFile = (s: number, e: number) =>
      hasEmbed || (s === 1 && (r.videos ?? []).some((v) => v.episode === e));
    return r.seasons
      .map(
        (count, s): Season => ({
          number: s + 1,
          episodes: Array.from({ length: count }, (_, e) => ({
            number: e + 1,
            title: `Episódio ${e + 1}`,
            runtime: r.runtime,
          })).filter((ep) => hasFile(s + 1, ep.number)),
        }),
      )
      .filter((season) => season.episodes.length > 0);
  },

  async getSimilar(t) {
    return titles
      .filter((o) => o.id !== t.id && o.genres.some((g) => t.genres.indexOf(g) >= 0))
      .sort((a, b) => Number(b.type === t.type) - Number(a.type === t.type))
      .slice(0, 12);
  },

  async search(q) {
    const needle = fold(q.trim());
    if (!needle) return [];
    return titles.filter((t) =>
      [t.title, t.originalTitle ?? '', ...t.genres].some((field) => fold(field).includes(needle)),
    );
  },
};
