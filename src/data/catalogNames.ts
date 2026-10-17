// O addon de catálogo traduz títulos e sinopses, mas não os nomes das listas.
export const CATALOG_NAMES_PT: Record<string, string> = {
  'trending-movies': 'Filmes em alta',
  'trending-series': 'Séries em alta',
  'popular-movies': 'Filmes populares',
  'popular-series': 'Séries populares',
  'airing-today-series': 'No ar hoje',
  'critically-acclaimed-movies': 'Filmes aclamados pela crítica',
  'critically-acclaimed-series': 'Séries aclamadas pela crítica',
  'new-and-upcoming-movies': 'Filmes novos e em breve',
  'new-and-returning-series': 'Séries novas e de volta',
  'netflix-movies': 'Filmes da Netflix',
  'netflix-series': 'Séries da Netflix',
  'disney-plus-movies': 'Filmes do Disney+',
  'disney-plus-series': 'Séries do Disney+',
  'prime-video-movies': 'Filmes do Prime Video',
  'prime-video-series': 'Séries do Prime Video',
  'international-cinema': 'Cinema internacional',
  'international-series': 'Séries internacionais',
  'independent-and-festival-picks': 'Independentes e de festival',
  'limited-series': 'Minisséries',
  documentaries: 'Documentários',
  'documentary-series': 'Séries documentais',
  'family-movies': 'Filmes para a família',
  'family-series': 'Séries para a família',
};

/** Listas que só fazem sentido com um filtro escolhido (ano, idioma): ficam fora das fileiras. */
export const PARAMETERIZED_CATALOGS = ['movies-by-year', 'series-by-year', 'movies-by-language', 'series-by-language'];

