// Estado local do espectador. Sem conta: tudo fica no aparelho.
// localStorage pode falhar ou estar cheio na TV, então nada aqui lança.
import type { SourceProfile } from '../streams/rank';
import type { Title, TitleType } from './types';

/** O bastante para desenhar um card sem voltar a consultar o catálogo. */
export interface TitleSnapshot {
  id: string;
  type: TitleType;
  title: string;
  poster?: string;
  backdrop?: string;
  logo?: string;
  year?: number;
}

export interface Progress {
  title: TitleSnapshot;
  season?: number;
  episode?: number;
  /** segundos */
  time: number;
  duration: number;
  updatedAt: number;
}

// Prefixo de quando havia mais de um catálogo: mantido para não perder lista e progresso já guardados.
const key = (name: string) => `freeflix.freeflix.${name}`;

function read<T>(name: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key(name));
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(name: string, value: unknown) {
  try {
    window.localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    /* sem persistência nesta sessão */
  }
}

export const snapshotOf = (t: Title): TitleSnapshot => ({
  id: t.id,
  type: t.type,
  title: t.title,
  poster: t.poster,
  backdrop: t.backdrop,
  logo: t.logo,
  year: t.year,
});

export const titleFromSnapshot = (s: TitleSnapshot): Title => ({ ...s, genres: [], synopsis: '' });

/** Progresso de um episódio. */
export interface EpisodeProgress {
  time: number;
  duration: number;
}

/** Créditos não contam: faltando isso, o vídeo já foi visto. */
const FINISH_MARGIN_S = 30;
const FINISH_MARGIN = 0.05;

/** Visto até o fim (ou até os créditos)? */
export const isFinished = (p: { time: number; duration: number }) =>
  p.duration > 0 && p.time >= p.duration - Math.max(FINISH_MARGIN_S, p.duration * FINISH_MARGIN);

const episodeKey = (season: number, episode: number) => `${season}:${episode}`;

export function getAllProgress(): Record<string, Progress> {
  return read<Record<string, Progress>>('progress', {});
}

export function getProgress(id: string): Progress | undefined {
  return getAllProgress()[id];
}

export function saveProgress(title: Title, p: Omit<Progress, 'updatedAt' | 'title'>) {
  const all = getAllProgress();
  all[title.id] = { ...p, title: snapshotOf(title), updatedAt: Date.now() };
  write('progress', all);
  if (p.season != null && p.episode != null) {
    const episodes = read<Record<string, Record<string, EpisodeProgress>>>('episodes', {});
    const mine = episodes[title.id] ?? {};
    mine[episodeKey(p.season, p.episode)] = { time: Math.round(p.time), duration: Math.round(p.duration) };
    episodes[title.id] = mine;
    write('episodes', episodes);
  }
}

/** Progresso de cada episódio da série já aberto neste aparelho: "temporada:episódio" -> progresso. */
export function getEpisodeProgress(id: string): Record<string, EpisodeProgress> {
  return read<Record<string, Record<string, EpisodeProgress>>>('episodes', {})[id] ?? {};
}

export const episodeProgressOf = (all: Record<string, EpisodeProgress>, season: number, episode: number) =>
  all[episodeKey(season, episode)];

/** quantas séries guardam a fonte escolhida; as mais antigas saem */
const SOURCE_CHOICES = 60;

/** Fonte que tocou por último nesta série: o próximo episódio procura a mesma. */
export function preferredSource(id: string): SourceProfile | undefined {
  const saved = read<{ id: string; profile: SourceProfile }[]>('sources', []).filter((c) => c.id === id)[0];
  return saved ? saved.profile : undefined;
}

export function rememberSource(id: string, profile: SourceProfile) {
  const rest = read<{ id: string; profile: SourceProfile }[]>('sources', []).filter((c) => c.id !== id);
  write('sources', [{ id, profile }, ...rest].slice(0, SOURCE_CHOICES));
}

export function getMyList(): TitleSnapshot[] {
  return read<TitleSnapshot[]>('mylist', []);
}

export function inMyList(id: string): boolean {
  return getMyList().some((t) => t.id === id);
}

/** Devolve true se o título ficou na lista. */
export function toggleMyList(title: Title): boolean {
  const list = getMyList();
  const kept = list.filter((t) => t.id !== title.id);
  const added = kept.length === list.length;
  if (added) kept.unshift(snapshotOf(title));
  write('mylist', kept);
  return added;
}
