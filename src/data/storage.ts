// Estado local do espectador. Sem conta: tudo fica no aparelho.
// localStorage pode falhar ou estar cheio na TV, então nada aqui lança.
import { getSettings } from '../settings';
import type { Title, TitleType } from './types';

/** O bastante para desenhar um card sem voltar a consultar o catálogo. */
export interface TitleSnapshot {
  id: string;
  type: TitleType;
  title: string;
  poster?: string;
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

// Cada catálogo tem ids próprios, então lista e progresso são separados por catálogo.
const key = (name: string) => `freeflix.${getSettings().catalog}.${name}`;

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
  year: t.year,
});

export const titleFromSnapshot = (s: TitleSnapshot): Title => ({ ...s, genres: [], synopsis: '' });

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
