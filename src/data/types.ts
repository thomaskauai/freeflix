export type TitleType = 'movie' | 'series';

export interface Title {
  /** no catálogo por addon é o id IMDb (tt…) ou tmdb:… */
  id: string;
  type: TitleType;
  title: string;
  originalTitle?: string;
  year?: number;
  /** minutos; em séries, duração média do episódio */
  runtime?: number;
  genres: string[];
  tagline?: string;
  synopsis: string;
  poster?: string;
  backdrop?: string;
  /** arte do título, usada no lugar do nome em texto */
  logo?: string;
  /** nota IMDb */
  rating?: string;
  /** código do idioma original (en, pt, ja…) */
  originalLanguage?: string;
  tmdbId?: number | null;
  /** id IMDb (tt…), quando o id do catálogo não é ele */
  imdbId?: string;
  isNew?: boolean;
  seasonCount?: number;
  episodeCount?: number;
}

/** O TMDB chama novela de "Soap" (as brasileiras, as turcas, as americanas). */
export const isSoap = (title: Pick<Title, 'genres'>) => title.genres.indexOf('Soap') >= 0;

/** Série, filme ou novela, para os selos e cartões. */
export const kindLabel = (title: Pick<Title, 'type' | 'genres'>) =>
  title.type === 'movie' ? 'Filme' : isSoap(title) ? 'Novela' : 'Série';

export interface Episode {
  number: number;
  title: string;
  /** minutos */
  runtime?: number;
  thumbnail?: string;
  /** resumo do episódio */
  overview?: string;
  /** data em que foi ao ar (ISO) */
  released?: string;
}

export interface Season {
  number: number;
  episodes: Episode[];
}

/** wide: cartão horizontal (16:9), usado em Continuar assistindo */
export type RowStyle = 'poster' | 'tall' | 'wide';

/** Descritor de uma fileira; os itens vêm depois, por loadRow. */
export interface RowRef {
  id: string;
  title: string;
  style: RowStyle;
  /** só no catálogo por addon */
  type?: TitleType;
  catalogId?: string;
  /** primeira página da lista (itens pulados), sorteada para a Home não ficar sempre igual */
  skip?: number;
  /** embaralhar os itens de cada página */
  shuffle?: boolean;
  /** gênero do addon (filtro genre da lista) */
  genre?: string;
  /** fileira montada pelo app (top-rated) ou vinda do addon de streamings */
  /** globoplay: lista do api/globoplay.ts, com o nome dela em catalogId */
  kind?: 'top-rated' | 'streaming' | 'novelas' | 'globoplay';
  /** cards mostram a nota IMDb */
  showRating?: boolean;
}

export type RowFilter = 'movie' | 'series';

export interface CatalogProvider {
  /** destaques do topo da Home, na ordem em que aparecem */
  getFeatured(): Promise<Title[]>;
  /** Fileiras de uma seção, sem os itens: carregar todas de uma vez pesa na TV. */
  listRows(filter?: RowFilter): Promise<RowRef[]>;
  /** itens de uma fileira; page 1, 2… traz mais itens para o fim dela (vazio: acabou) */
  loadRow(ref: RowRef, page?: number): Promise<Title[]>;
  getTitle(type: TitleType, id: string): Promise<Title | null>;
  /**
   * O que já se sabe do título pelas listas (fileiras, busca, semelhantes), sem
   * ir ao servidor: dá para abrir os detalhes antes de getTitle responder.
   * Faltam duração, idioma e episódios.
   */
  peekTitle(type: TitleType, id: string): Title | null;
  getSeasons(type: TitleType, id: string): Promise<Season[]>;
  getSimilar(title: Title): Promise<Title[]>;
  search(q: string): Promise<Title[]>;
}
