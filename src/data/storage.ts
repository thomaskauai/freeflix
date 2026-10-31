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
  /** imagem do episódio onde o espectador parou (cartão horizontal de Continuar assistindo) */
  still?: string;
}

export interface Progress {
  title: TitleSnapshot;
  season?: number;
  episode?: number;
  /** segundos */
  time: number;
  duration: number;
  updatedAt: number;
  /** visto até o fim (marcado aqui ou em outra TV da casa) */
  finished?: boolean;
}

// Prefixo de quando havia mais de um catálogo: mantido para não perder lista e progresso já guardados.
const key = (name: string) => `freeflix.freeflix.${name}`;

export function read<T>(name: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key(name));
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function write(name: string, value: unknown) {
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
  updatedAt?: number;
  /** visto até o fim (marcado aqui ou em outra TV da casa) */
  finished?: boolean;
}

/** Algo que começou a ser visto: "id" (filme) ou "id:temporada:episódio". */
export interface Watched {
  titleId: string;
  season?: number;
  episode?: number;
  watchedAt: number;
  finished: boolean;
}

/** Créditos não contam: faltando isso, o vídeo já foi visto. */
const FINISH_MARGIN_S = 30;
const FINISH_MARGIN = 0.05;

/** Visto até o fim (ou até os créditos)? */
export const isFinished = (p: { time: number; duration: number; finished?: boolean }) =>
  !!p.finished || (p.duration > 0 && p.time >= p.duration - Math.max(FINISH_MARGIN_S, p.duration * FINISH_MARGIN));

export const episodeKey = (season: number, episode: number) => `${season}:${episode}`;

/** Id do que foi assistido: o do título (filme) ou com temporada e episódio. */
export const contentIdOf = (titleId: string, season?: number, episode?: number) =>
  season != null && episode != null ? `${titleId}:${season}:${episode}` : titleId;

export function getAllProgress(): Record<string, Progress> {
  return read<Record<string, Progress>>('progress', {});
}

export function getProgress(id: string): Progress | undefined {
  return getAllProgress()[id];
}

/** Grava onde o vídeo está. `still` é a imagem do episódio, para o cartão de Continuar assistindo. */
export function saveProgress(title: Title, p: Omit<Progress, 'updatedAt' | 'title'>, still?: string) {
  const now = Date.now();
  const all = getAllProgress();
  const finished = isFinished(p);
  // a imagem do episódio chega depois da lista de episódios; até lá vale a já guardada dele
  const before = all[title.id];
  const sameEpisode = !!before && before.season === p.season && before.episode === p.episode;
  const image = still ?? (sameEpisode ? before.title.still : undefined);
  all[title.id] = { ...p, finished, title: { ...snapshotOf(title), still: image }, updatedAt: now };
  write('progress', all);
  if (p.season != null && p.episode != null) {
    const episodes = getAllEpisodeProgress();
    const mine = episodes[title.id] ?? {};
    mine[episodeKey(p.season, p.episode)] = {
      time: Math.round(p.time),
      duration: Math.round(p.duration),
      updatedAt: now,
      finished,
    };
    episodes[title.id] = mine;
    write('episodes', episodes);
  }
}

/** Imagem do episódio guardado em Continuar assistindo, sem mexer no horário (não sincroniza de novo). */
export function rememberStill(titleId: string, season: number, episode: number, still: string) {
  const all = getAllProgress();
  const p = all[titleId];
  if (!p || p.season !== season || p.episode !== episode || p.title.still === still) return;
  all[titleId] = { ...p, title: { ...p.title, still } };
  write('progress', all);
}

export const getAllEpisodeProgress = () => read<Record<string, Record<string, EpisodeProgress>>>('episodes', {});

/** Progresso de cada episódio da série já aberto neste aparelho: "temporada:episódio" -> progresso. */
export function getEpisodeProgress(id: string): Record<string, EpisodeProgress> {
  return getAllEpisodeProgress()[id] ?? {};
}

/** Tudo que já começou a ser visto, por contentIdOf. */
export const getHistory = () => read<Record<string, Watched>>('history', {});

/** Começou (ou terminou) de ver: entra no histórico. Devolve a entrada se mudou. */
export function recordWatched(
  titleId: string,
  season: number | undefined,
  episode: number | undefined,
  finished: boolean,
) {
  const all = getHistory();
  const id = contentIdOf(titleId, season, episode);
  const before = all[id];
  if (before && (before.finished || !finished) && Date.now() - before.watchedAt < 60 * 1000) return null;
  all[id] = { titleId, season, episode, watchedAt: Date.now(), finished: finished || (!!before && before.finished) };
  write('history', all);
  return { id, entry: all[id] };
}

/** Visto até o fim, por este ou outro aparelho da casa? */
export function wasFinished(titleId: string, season?: number, episode?: number): boolean {
  const entry = getHistory()[contentIdOf(titleId, season, episode)];
  return !!entry && entry.finished;
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

/** Legenda escolhida no player: o idioma (null: desligada) e, no mesmo vídeo, a versão e o ajuste. */
export interface SubtitleChoice {
  language: string | null;
  /** vídeo (id IMDb, com :temporada:episódio) e release da fonte em que versão e ajuste valem */
  videoId?: string;
  release?: string;
  /** a versão escolhida (endereço da legenda) */
  url?: string;
  /** ajuste de sincronia, em segundos */
  offset?: number;
}

/**
 * Escolhas do player para um título, junto do progresso dele: Continuar
 * assistindo volta com elas. Ficam no aparelho (não vão para a casa).
 */
export interface TitleChoice {
  /** áudio do filme (o da série fica em audioMemory) */
  audio?: string;
  subtitle?: SubtitleChoice;
  /** fonte do filme (a da série fica em preferredSource) */
  source?: SourceProfile;
  /** quando mudou por último */
  at: number;
}

/** quantos títulos guardam escolhas; os mais antigos saem */
const TITLE_CHOICES = 100;

export const getChoice = (id: string): TitleChoice | undefined => read<Record<string, TitleChoice>>('choices', {})[id];

export function saveChoice(id: string, change: Partial<Omit<TitleChoice, 'at'>>) {
  const all = read<Record<string, TitleChoice>>('choices', {});
  all[id] = { ...all[id], ...change, at: Date.now() };
  const ids = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
  ids.slice(TITLE_CHOICES).forEach((old) => delete all[old]);
  write('choices', all);
}

export function forgetChoice(id: string) {
  const all = read<Record<string, TitleChoice>>('choices', {});
  if (!all[id]) return;
  delete all[id];
  write('choices', all);
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

/**
 * Player aberto agora: a rota dele (/watch/…) e quando foi visto ativo. Sai
 * quando o espectador deixa o player; se a TV desliga ou o app fecha com ele
 * aberto, fica, e a próxima abertura do app volta para ele.
 */
export interface PlayerSession {
  path: string;
  at: number;
}

export const getPlayerSession = () => read<PlayerSession | null>('player-session', null);
export const markPlayerSession = (path: string) => write('player-session', { path, at: Date.now() });
export const clearPlayerSession = () => write('player-session', null);
