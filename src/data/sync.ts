// Sincronização de Continuar assistindo e do histórico entre as TVs da casa,
// pelo código da casa (6 dígitos, sem conta). O servidor é a fonte da verdade;
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

const SITE = 'https://freefliix.vercel.app';
// No navegador a API está no mesmo endereço do site; o app da TV abre de file:// e usa o do site.
const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ||
  (/^https?:$/.test(window.location.protocol) ? '' : SITE);
/** onde o celular abre o link do QR code */
const PAIR_PAGE = `${API_BASE || window.location.origin}/parear.html`;
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
/** código com que este aparelho já está registrado no servidor */
const REGISTERED_KEY = 'freeflix.device.registered';

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
export function houseCode(): string | null {
  const code = local<{ code?: string } | null>(HOUSE_KEY, null)?.code ?? null;
  // códigos de 8 dígitos da primeira versão viraram os 6 últimos
  if (code && /^[0-9]{8}$/.test(code)) {
    keep(HOUSE_KEY, { code: code.slice(2) });
    return code.slice(2);
  }
  return code;
}

/** Duas passadas de FNV-1a: o identificador da TV não sai do aparelho como é. */
function digest(text: string): string {
  const pass = (seed: number) => {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  };
  return pass(2166136261) + pass(0x9747b28c);
}

/** Identificador da Samsung (DUID): o mesmo mesmo depois de reinstalar o app. */
function tvIdentity(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const webapis = (window as any).webapis;
    const duid = webapis && webapis.productinfo && webapis.productinfo.getDuid();
    return typeof duid === 'string' && duid.length > 4 ? duid : null;
  } catch {
    return null;
  }
}

/**
 * Id deste aparelho. Na TV Samsung sai do identificador do aparelho, então a
 * TV reencontra a casa mesmo reinstalada; fora dela, um id sorteado e guardado.
 * O servidor também conta as tentativas de código por ele.
 */
function deviceId(): string {
  let id = local<string>(DEVICE_KEY, '');
  if (/^[A-Za-z0-9-]{8,64}$/.test(id)) return id;
  const duid = tvIdentity();
  id = duid
    ? `tv-${digest(duid)}`
    : `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  keep(DEVICE_KEY, id);
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
        if (err instanceof ApiError && err.status === 404) forgetHouse();
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
        if (err instanceof ApiError && err.status === 404) forgetHouse();
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

/**
 * Ao abrir o app: TV sem código pergunta ao servidor se ela já é de alguma
 * casa (reinstalada, dados apagados); com código, busca as novidades. Depois
 * busca de novo quando o app volta a aparecer e já faz um tempo.
 */
export function startSync() {
  const code = houseCode();
  if (code) {
    pull();
    // TV vinculada antes de o servidor guardar os aparelhos: registra uma vez
    if (local<string>(REGISTERED_KEY, '') !== code) {
      call('/house', { action: 'link', code, device: deviceId() }).then(
        () => keep(REGISTERED_KEY, code),
        () => undefined,
      );
    }
  } else {
    call(`/house?device=${encodeURIComponent(deviceId())}`).then(
      (data) => {
        if (typeof data.code === 'string' && !houseCode()) {
          adopt(data.code).then(() => window.dispatchEvent(new Event(SYNC_EVENT)));
        }
      },
      () => undefined,
    );
  }
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
  keep(REGISTERED_KEY, code);
  write(SENT, {});
  return pull();
}

export type Pairing = { status: 'waiting'; token: string; url: string } | { status: 'locked'; minutes: number } | { status: 'offline' };

/** Criar código: a TV pede um QR; o celular que abrir o link cria a casa. */
export function startPairing(): Promise<Pairing> {
  return call('/pair', { action: 'start', device: deviceId() }).then(
    (data): Pairing => {
      const token = String(data.token);
      return { status: 'waiting', token, url: `${PAIR_PAGE}?t=${token}` };
    },
    (err): Pairing => {
      const f = failure(err);
      return f.status === 'locked' ? f : { status: 'offline' };
    },
  );
}

/** O celular já criou a casa? Quando sim, esta TV entra nela. */
export function checkPairing(token: string): Promise<'waiting' | 'expired' | LinkResult> {
  return call(`/pair?t=${token}&device=${encodeURIComponent(deviceId())}`).then(
    (data) => {
      if (data.status === 'done' && typeof data.code === 'string') {
        const code = data.code;
        return adopt(code).then((): LinkResult => ({ status: 'ok', code }));
      }
      return data.status === 'expired' ? 'expired' : 'waiting';
    },
    () => 'waiting' as const,
  );
}

/** Liga esta TV a um código que já existe. */
export function linkHouse(code: string): Promise<LinkResult> {
  return call('/house', { action: 'link', code, device: deviceId() }).then(
    () => adopt(code).then((): LinkResult => ({ status: 'ok', code })),
    failure,
  );
}

/** Esta TV para de sincronizar (e o servidor esquece de que casa ela é). O que já está nela continua aqui. */
export function unlinkHouse() {
  call('/house', { action: 'unlink', device: deviceId() }).catch(() => undefined);
  forgetHouse();
}

/** Some com o código só neste aparelho (o servidor não o conhece mais). */
function forgetHouse() {
  keep(HOUSE_KEY, null);
  write(PENDING, { progress: {}, history: {} });
  write(SENT, {});
  window.dispatchEvent(new Event(SYNC_EVENT));
}
