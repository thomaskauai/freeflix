// O addon de catálogo traduz títulos e sinopses, mas não os nomes das listas.
export const CATALOG_NAMES_PT: Record<string, string> = {
  'trending-movies': 'Filmes em alta',
  'trending-series': 'Séries em alta',
  'popular-movies': 'Filmes populares',
  'popular-series': 'Séries populares',
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

/**
 * Listas que ficam fora das fileiras. "No ar hoje" é qualquer série com episódio
 * passando hoje em algum país (talk shows, novelas de 1970…), não novidades.
 */
export const HIDDEN_CATALOGS = ['airing-today-series'];

/**
 * Gêneros que viram fileira em Filmes e Séries (filtro genre de "populares").
 * Documentário e família já têm lista própria; os de TV aberta ficam de fora.
 */
export const GENRE_NAMES_PT: Record<string, string> = {
  Action: 'Ação',
  Adventure: 'Aventura',
  'Action & Adventure': 'Ação e aventura',
  Animation: 'Animação',
  Comedy: 'Comédia',
  Crime: 'Crime',
  Drama: 'Drama',
  Fantasy: 'Fantasia',
  'Science Fiction': 'Ficção científica',
  'Sci-Fi & Fantasy': 'Ficção científica e fantasia',
  Horror: 'Terror',
  Thriller: 'Suspense',
  Mystery: 'Mistério',
  Romance: 'Romance',
  History: 'História',
  War: 'Guerra',
  'War & Politics': 'Guerra e política',
  Music: 'Música',
  Western: 'Faroeste',
  Kids: 'Infantil',
};

/** Nomes dos gêneros na tela (o catálogo em português os manda em inglês). */
export const GENRE_LABELS_PT: Record<string, string> = {
  ...GENRE_NAMES_PT,
  Soap: 'Novela',
  Documentary: 'Documentário',
  Family: 'Família',
  News: 'Notícias',
  Reality: 'Reality show',
  Talk: 'Talk show',
};

/** Listas que só fazem sentido com um filtro escolhido (ano, idioma): ficam fora das fileiras. */
export const PARAMETERIZED_CATALOGS = ['movies-by-year', 'series-by-year', 'movies-by-language', 'series-by-language'];

