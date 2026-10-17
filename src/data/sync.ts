// Sincronização de Continuar assistindo e do histórico entre as TVs da casa,
// pelo código da casa (8 dígitos, sem conta). O servidor é a fonte da verdade;
// o que está no aparelho é cache e fila de envio. Sem código, nada sai daqui.
import { useEffect, useState } from 'react';
import {
  contentIdOf,
  episodeKey,
  getAllEpisodeProgress,
  getAllProgress,
  getHistory,
  isFinished,
  read,
  recordWatched,
  snapshotOf,
  write,
  type EpisodeProgress,
  type Progress,
  type TitleSnapshot,
  type Watched,
} from './storage';
import type { Title } from './types';

// No navegador a API está no mesmo endereço do site; o app da TV abre de file:// e usa o do site.
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ||
  (/^https?:$/.test(window.location.protocol) ? '' : 'https://freefliix.vercel.app');
const API = `${API_BASE.replace(/\/$/, '')}/api`;
const TIMEOUT_MS = 12000;
/** posição vai ao servidor no máximo a cada 10 s; pausa e saída do player vão na hora */
const PUSH_EVERY_MS = 10000;
/** voltar ao app (trocar de entrada da TV, por exemplo) busca de novo, se faz tempo */
const PULL_AGAIN_MS = 30000;
/** avisado quando chegam dados de outra TV: telas abertas se redesenham */
export const SYNC_EVENT = 'freeflix:sync';

const HOUSE_KEY = 'freeflix.house';
const DEVICE_KEY = 'freeflix.device';

function local<T>(name: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(name);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function keep(name: string, value: unknown) {
  try {
    if (value == null) window.localStorage.removeItem(name);
    else window.localStorage.setItem(name, JSON.stringify(value));
  } catch {
    /* sem persistência nesta sessão */
  }
}

/** Código da casa desta TV, ou null se ela não sincroniza. */
export const houseCode = (): string | null => local<{ code?: string } | null>(HOUSE_KEY, null)?.code ?? null;

/** Id aleatório deste aparelho: o servidor conta as tentativas de código por ele. */
function deviceId(): string {
  let id = local<string>(DEVICE_KEY, '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    id = `tv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    keep(DEVICE_KEY, id);
  }
  return id;
}

// ---------- Rede ----------

class ApiError extends Error {
  constructor(
    public status: number,
    public body: Record<string, unknown>,
  ) {
    super(`api ${status}`);
  }
}

async function call(path: string, body?: unknown): Promise<Record<string, unknown>> {
  let timer = 0;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
  });
  try {
    // text/plain: pedido "simples", sem preflight de CORS nas TVs antigas
    const request = fetch(
      `${API}${path}`,
      body === undefined
        ? undefined
        : { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain' } },
    );
    const res = await Promise.race([request, timeout]);
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) throw new ApiError(res.status, data);
    return data;
  } finally {
    window.clearTimeout(timer);
  }
}

// ---------- Formato do servidor ----------

interface ProgressRow {
  content_id: string;
  title_id: string;
  season: number | null;
  episode: number | null;
  position_seconds: number;
  duration_seconds: number;
  finished: boolean;
  title: TitleSnapshot | null;
  updated_at: string | number;
}

interface HistoryRow {
  content_id: string;
  title_id: string;
  season: number | null;
  episode: number | null;
  title: TitleSnapshot | null;
  watched_at: string | number;
  finished: boolean;
}

const time = (value: string | number) => (typeof value === 'number' ? value : Date.parse(value) || 0);

// ---------- Fila de envio ----------

interface Pending {
  progress: Record<string, ProgressRow>;
  history: Record<string, HistoryRow>;
}

const PENDING = 'sync.pending';
/** última posição enviada de cada conteúdo: igual não vai de novo (vídeo pausado) */
const SENT = 'sync.sent';

const pending = () => read<Pending>(PENDING, { progress: {}, history: {} });
const signature = (r: ProgressRow) =>
  `${Math.round(r.position_seconds)}|${Math.round(r.duration_seconds)}|${r.finished}`;

function queue(progress: ProgressRow[], history: HistoryRow[]) {
  const box = pending();
  const sent = read<Record<string, string>>(SENT, {});
  progress.forEach((r) => {
    if (sent[r.content_id] !== signature(r)) box.progress[r.content_id] = r;
  });
  history.forEach((r) => (box.history[r.content_id] = r));
  write(PENDING, box);
}

function progressRow(
  titleId: string,
  snapshot: TitleSnapshot | null,
  season: number | undefined,
  episode: number | undefined,
  p: { time: number; duration: number; updatedAt?: number; finished?: boolean },
): ProgressRow {
  return {
    content_id: contentIdOf(titleId, season, episode),
    title_id: titleId,
    season: season ?? null,
    episode: episode ?? null,
    position_seconds: Math.round(p.time),
    duration_seconds: Math.round(p.duration),
    finished: isFinished(p),
    title: snapshot,
    updated_at: p.updatedAt ?? 0,
  };
}

const historyRow = (id: string, w: Watched, snapshot: TitleSnapshot | null): HistoryRow => ({
  content_id: id,
  title_id: w.titleId,
  season: w.season ?? null,
  episode: w.episode ?? null,
  title: snapshot,
  watched_at: w.watchedAt,
  finished: w.finished,
});

let pushTimer = 0;
let pushing: Promise<void> | null = null;

/** Manda a fila. Sem rede, ela fica para a próxima. */
function push(): Promise<void> {
  const code = houseCode();
  if (!code) return Promise.resolve();
  if (pushing) return pushing.then(push);
  const box = pending();
  const progress = Object.keys(box.progress).map((k) => box.progress[k]);
  const history = Object.keys(box.history).map((k) => box.history[k]);
  if (!progress.length && !history.length) return Promise.resolve();
  pushing = call('/sync', { code, device: deviceId(), progress, history })
    .then(
      () => {
        // o que entrou na fila durante o envio fica para o próximo
        const now = pending();
        const sent = read<Record<string, string>>(SENT, {});
        progress.forEach((r) => {
          sent[r.content_id] = signature(r);
          if (now.progress[r.content_id] && signature(now.progress[r.content_id]) === signature(r)) {
            delete now.progress[r.content_id];
          }
        });
        history.forEach((r) => {
          const queued = now.history[r.content_id];
          if (queued && queued.watched_at === r.watched_at && queued.finished === r.finished) {
            delete now.history[r.content_id];
          }
        });
        write(SENT, sent);
        write(PENDING, now);
      },
      (err) => {
        // código apagado no servidor: a TV deixa de sincronizar
        if (err instanceof ApiError && err.status === 404) unlinkHouse();
      },
    )
    .then(() => {
      pushing = null;
    });
  return pushing;
}

/** Envia logo (pausa, saída do player) ou no máximo a cada 10 s. */
function schedule(now: boolean) {
  if (!houseCode()) return;
  if (now) {
    window.clearTimeout(pushTimer);
    pushTimer = 0;
    push();
  } else if (!pushTimer) {
    pushTimer = window.setTimeout(() => {
      pushTimer = 0;
      push();
    }, PUSH_EVERY_MS);
  }
}

// ---------- O que o player chama ----------

export type ProgressMoment = 'tick' | 'pause' | 'exit';

/** Posição do vídeo, já guardada no aparelho; vai ao servidor se mudou. */
export function syncProgress(
  title: Title,
  season: number | undefined,
  episode: number | undefined,
  moment: ProgressMoment,
) {
  if (!houseCode()) return;
  const saved = getAllProgress()[title.id];
  if (!saved) return;
  const own: EpisodeProgress | Progress | undefined =
    season != null && episode != null ? (getAllEpisodeProgress()[title.id] ?? {})[episodeKey(season, episode)] : saved;
  if (!own) return;
  const row = progressRow(title.id, saved.title, season, episode, own);
  const history: HistoryRow[] = [];
  // terminou: o histórico ganha o "visto até o fim"
  if (row.finished) {
    const changed = recordWatched(title.id, season, episode, true);
    if (changed) history.push(historyRow(changed.id, changed.entry, saved.title));
  }
  queue([row], history);
  schedule(moment !== 'tick');
}

/** O vídeo começou: entra no histórico (e no servidor, se a TV sincroniza). */
export function syncStarted(title: Title, season?: number, episode?: number) {
  const changed = recordWatched(title.id, season, episode, false);
  if (!changed || !houseCode()) return;
  queue([], [historyRow(changed.id, changed.entry, snapshotOf(title))]);
  schedule(true);
}

// ---------- Busca e junção ----------

let lastPull = 0;
let pulling: Promise<void> | null = null;

/**
 * Traz posições e histórico da casa e junta com o do aparelho: em cada
 * conteúdo vale o registro mais recente. O que está mais novo aqui volta para
 * a fila de envio, então uma TV que ficou sem rede alcança as outras.
 */
export function pull(): Promise<void> {
  const code = houseCode();
  if (!code) return Promise.resolve();
  if (pulling) return pulling;
  pulling = call(`/sync?code=${code}&device=${encodeURIComponent(deviceId())}`)
    .then(
      (data) => {
        lastPull = Date.now();
        merge((data.progress as ProgressRow[]) || [], (data.history as HistoryRow[]) || []);
        return push();
      },
      (err) => {
        if (err instanceof ApiError && err.status === 404) unlinkHouse();
      },
    )
    .then(() => {
      pulling = null;
    });
  return pulling;
}

function merge(rows: ProgressRow[], historyRows: HistoryRow[]) {
  const all = getAllProgress();
  const episodes = getAllEpisodeProgress();
  const history = getHistory();
  const remote: Record<string, boolean> = {};
  let changed = false;

  rows.forEach((r) => {
    remote[r.content_id] = true;
    const at = time(r.updated_at);
    const value = { time: r.position_seconds, duration: r.duration_seconds, updatedAt: at, finished: r.finished };
    const season = r.season ?? undefined;
    const episode = r.episode ?? undefined;
    if (season != null && episode != null) {
      const mine = episodes[r.title_id] ?? (episodes[r.title_id] = {});
      const here = mine[episodeKey(season, episode)];
      if (!here || (here.updatedAt ?? 0) < at) {
        mine[episodeKey(season, episode)] = value;
        changed = true;
      }
    }
    // Continuar assistindo guarda, por título, o conteúdo mais recente
    const here = all[r.title_id];
    if ((!here || here.updatedAt < at) && (r.title || here)) {
      all[r.title_id] = { ...value, season, episode, title: r.title ?? here.title };
      changed = true;
    }
  });

  historyRows.forEach((r) => {
    remote[`h:${r.content_id}`] = true;
    const here = history[r.content_id];
    const at = time(r.watched_at);
    if (!here || here.watchedAt < at || (r.finished && !here.finished)) {
      history[r.content_id] = {
        titleId: r.title_id,
        season: r.season ?? undefined,
        episode: r.episode ?? undefined,
        watchedAt: Math.max(at, here ? here.watchedAt : 0),
        finished: r.finished || (!!here && here.finished),
      };
      changed = true;
    }
  });

  // O que só existe aqui, ou está mais novo aqui, sobe.
  const serverAt: Record<string, number> = {};
  rows.forEach((r) => (serverAt[r.content_id] = time(r.updated_at)));
  const up: ProgressRow[] = [];
  Object.keys(all).forEach((titleId) => {
    const p = all[titleId];
    const mine = episodes[titleId];
    if (mine) {
      Object.keys(mine).forEach((k) => {
        const [s, e] = k.split(':').map(Number);
        const ep = mine[k];
        // episódio de antes do histórico com horário: vale o horário do título, se for o dele
        const at = ep.updatedAt ?? (p.season === s && p.episode === e ? p.updatedAt : 0);
        const row = progressRow(titleId, p.title, s, e, { ...ep, updatedAt: at });
        if ((serverAt[row.content_id] ?? -1) < time(row.updated_at)) up.push(row);
      });
    } else if (p.season == null) {
      const row = progressRow(titleId, p.title, undefined, undefined, p);
      if ((serverAt[row.content_id] ?? -1) < time(row.updated_at)) up.push(row);
    }
  });
  const upHistory = Object.keys(history)
    .filter((id) => !remote[`h:${id}`])
    .map((id) => historyRow(id, history[id], all[history[id].titleId] ? all[history[id].titleId].title : null));

  write('progress', all);
  write('episodes', episodes);
  write('history', history);
  if (up.length || upHistory.length) {
    // a fila de envio compara com o último enviado; aqui é para mandar de qualquer jeito
    const sent = read<Record<string, string>>(SENT, {});
    up.forEach((r) => delete sent[r.content_id]);
    write(SENT, sent);
    queue(up, upHistory);
  }
  if (changed) window.dispatchEvent(new Event(SYNC_EVENT));
}

/** Busca de novo quando o app volta a aparecer e já faz um tempo. */
export function startSync() {
  pull();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastPull > PULL_AGAIN_MS) pull();
  });
}

/** Redesenha a tela quando chegam dados de outra TV. */
export function useSyncVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(SYNC_EVENT, bump);
    return () => window.removeEventListener(SYNC_EVENT, bump);
  }, []);
  return version;
}

// ---------- Código da casa ----------

export type LinkResult =
  | { status: 'ok'; code: string }
  | { status: 'not-found'; left: number }
  | { status: 'locked'; minutes: number }
  | { status: 'offline' };

function failure(err: unknown): LinkResult {
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return { status: 'locked', minutes: Math.max(1, Math.ceil(Number(err.body.retryAfter || 600) / 60)) };
    }
    if (err.status === 404) return { status: 'not-found', left: Number(err.body.left ?? 0) };
  }
  return { status: 'offline' };
}

/** Vinculou: guarda o código e junta o que esta TV tinha com o que a casa já tem. */
function adopt(code: string) {
  keep(HOUSE_KEY, { code });
  write(SENT, {});
  return pull();
}

/** O servidor sorteia um código novo para esta casa. */
export function createHouse(): Promise<LinkResult> {
  return call('/house', { action: 'create', device: deviceId() }).then(
    (data) => {
      const code = String(data.code);
      return adopt(code).then((): LinkResult => ({ status: 'ok', code }));
    },
    failure,
  );
}

/** Liga esta TV a um código que já existe. */
export function linkHouse(code: string): Promise<LinkResult> {
  return call('/house', { action: 'link', code, device: deviceId() }).then(
    () => adopt(code).then((): LinkResult => ({ status: 'ok', code })),
    failure,
  );
}

/** Esta TV para de sincronizar. O que já está nela continua aqui. */
export function unlinkHouse() {
  keep(HOUSE_KEY, null);
  write(PENDING, { progress: {}, history: {} });
  write(SENT, {});
  window.dispatchEvent(new Event(SYNC_EVENT));
}
