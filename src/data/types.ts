export type TitleType = 'movie' | 'series';

export interface VideoSource {
  url: string;
  /** segundos */
  duration: number;
  /** capítulo, em seriados */
  episode?: number;
}

export interface Title {
  id: string;
  type: TitleType;
  tmdbId: number | null;
  title: string;
  originalTitle: string;
  year: number;
  /** minutos; em séries, duração média do episódio */
  runtime: number;
  genres: string[];
  tagline: string;
  synopsis: string;
  poster?: string;
  backdrop?: string;
  isNew?: boolean;
  /** arquivos de vídeo tocáveis direto; filme: o primeiro é o principal */
  videos?: VideoSource[];
  seasonCount: number;
  episodeCount: number;
}

export interface Episode {
  number: number;
  title: string;
  runtime: number;
}

export interface Season {
  number: number;
  episodes: Episode[];
}

export type RowStyle = 'poster' | 'tall';

export interface Row {
  id: string;
  title: string;
  style: RowStyle;
  items: Title[];
}

export type RowFilter = 'movie' | 'series' | 'new';

export interface CatalogProvider {
  getFeatured(): Promise<Title>;
  getRows(filter?: RowFilter): Promise<Row[]>;
  getTitle(id: string): Promise<Title | null>;
  getTitles(ids: string[]): Promise<Title[]>;
  getSeasons(id: string): Promise<Season[]>;
  getSimilar(id: string): Promise<Title[]>;
  search(q: string): Promise<Title[]>;
}
