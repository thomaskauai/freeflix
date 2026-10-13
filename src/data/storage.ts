// Estado local do espectador. Sem conta: tudo fica no aparelho.
// localStorage pode falhar ou estar cheio na TV, então nada aqui lança.

export interface Progress {
  season?: number;
  episode?: number;
  /** segundos */
  time: number;
  duration: number;
  updatedAt: number;
}

const PROGRESS_KEY = 'freeflix.progress';
const LIST_KEY = 'freeflix.mylist';

function read<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem persistência nesta sessão */
  }
}

export function getAllProgress(): Record<string, Progress> {
  return read<Record<string, Progress>>(PROGRESS_KEY, {});
}

export function getProgress(id: string): Progress | undefined {
  return getAllProgress()[id];
}

export function saveProgress(id: string, p: Omit<Progress, 'updatedAt'>) {
  const all = getAllProgress();
  all[id] = { ...p, updatedAt: Date.now() };
  write(PROGRESS_KEY, all);
}

export function getMyList(): string[] {
  return read<string[]>(LIST_KEY, []);
}

export function inMyList(id: string): boolean {
  return getMyList().indexOf(id) >= 0;
}

/** Devolve true se o título ficou na lista. */
export function toggleMyList(id: string): boolean {
  const list = getMyList();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else list.unshift(id);
  write(LIST_KEY, list);
  return i < 0;
}
