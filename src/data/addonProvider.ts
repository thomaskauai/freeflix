import { fetchCatalog, fetchManifest, fetchMeta, type AddonMeta } from './addonClient';
import { CATALOG_NAMES_PT, NEW_CATALOGS, PARAMETERIZED_CATALOGS } from './catalogNames';
import type { CatalogProvider, Episode, RowRef, Season, Title, TitleType } from './types';

const SIMILAR_LIMIT = 12;

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

  return {
    async getFeatured() {
      const list = await catalogs();
      const first = list.filter((c) => c.type === 'movie')[0] ?? list[0];
      if (!first) return null;
      const items = (await fetchCatalog(base, first.type, first.id)).map(toTitle);
      return items.filter((t) => t.backdrop && t.synopsis)[0] ?? items[0] ?? null;
    },

    async listRows(filter) {
      const list = (await catalogs()).filter((c) => {
        if (filter === 'new') return NEW_CATALOGS.indexOf(c.id) >= 0;
        return !filter || c.type === filter;
      });
      return list.map(
        (c, i): RowRef => ({
          id: `${c.type}:${c.id}`,
          title: (localized && CATALOG_NAMES_PT[c.id]) || c.name,
          style: i === 0 ? 'tall' : 'poster',
          type: c.type as TitleType,
          catalogId: c.id,
        }),
      );
    },

    async loadRow(ref) {
      if (!ref.type || !ref.catalogId) return [];
      return (await fetchCatalog(base, ref.type, ref.catalogId)).map(toTitle);
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
      return items
        .map(toTitle)
        .filter((t) => t.id !== title.id)
        .slice(0, SIMILAR_LIMIT);
    },

    async search(q) {
      const query = q.trim();
      if (!query) return [];
      const [movies, series] = await Promise.all(
        (['movie', 'series'] as const).map((type) =>
          fetchCatalog(base, type, `popular-${type === 'series' ? 'series' : 'movies'}`, { search: query })
            .then((items) => items.map(toTitle))
            .catch(() => [] as Title[]),
        ),
      );
      // intercala para um tipo não empurrar o outro para fora da primeira tela
      const merged: Title[] = [];
      for (let i = 0; i < Math.max(movies.length, series.length); i++) {
        if (movies[i]) merged.push(movies[i]);
        if (series[i]) merged.push(series[i]);
      }
      return merged;
    },
  };
}
