export type TitleType = 'movie' | 'series';

export interface VideoSource {
  url: string;
  /** segundos */
  duration: number;
  /** capítulo, em seriados */
  episode?: number;
}

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
  publicDomain?: boolean;
  /** arquivos de vídeo tocáveis direto; filme: o primeiro é o principal */
  videos?: VideoSource[];
  seasonCount?: number;
  episodeCount?: number;
}

export interface Episode {
  number: number;
  title: string;
  /** minutos */
  runtime?: number;
  thumbnail?: string;
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export type RowStyle = 'poster' | 'tall';

/** Descritor de uma fileira; os itens vêm depois, por loadRow. */
export interface RowRef {
  id: string;
  title: string;
  style: RowStyle;
  /** só no catálogo por addon */
  type?: TitleType;
  catalogId?: string;
}

export type RowFilter = 'movie' | 'series' | 'new';

export interface CatalogProvider {
  getFeatured(): Promise<Title | null>;
  /** Fileiras de uma seção, sem os itens: carregar todas de uma vez pesa na TV. */
  listRows(filter?: RowFilter): Promise<RowRef[]>;
  loadRow(ref: RowRef): Promise<Title[]>;
  getTitle(type: TitleType, id: string): Promise<Title | null>;
  getSeasons(type: TitleType, id: string): Promise<Season[]>;
  getSimilar(title: Title): Promise<Title[]>;
  search(q: string): Promise<Title[]>;
}
