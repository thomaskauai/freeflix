// Torrent como fonte opcional do player ("Torrent" no menu de fontes).
//
// O app não fala BitTorrent: quem baixa é o motor local (torrent-engine/), um
// Node que serve o vídeo por HTTP em 127.0.0.1:2710 enquanto baixa. No Mac ele
// roda com `npm start` em torrent-engine/; na TV, como serviço do app, que o
// app sobe ao abrir (torrentAvailable). Sem o motor no ar (site em https,
// celular), a opção nem aparece.
//
// Os torrents vêm do Torrentio, já ordenados por seeds e sem CAM/screener. Daqui
// sai um só: o que o aparelho toca, na qualidade que a rede aguenta, no idioma
// preferido e com mais seeds. Gravação de cinema fica de fora de qualquer jeito.
import { fetchStreams, getJson, type AddonStream } from '../data/addonClient';
import type { Title } from '../data/types';
import { isTizen, startTorrentService } from '../platform/tizen';
import { getSettings } from '../settings';
import { getSpeed } from './network';
import { parseStream } from './parse';
import { rankTorrents, type TorrentStream } from './rank';
import { deviceCanPlay, type Candidate } from './resolve';
import { releaseOf, rememberRelease } from './subtitles';

export const ENGINE = 'http://127.0.0.1:2710';
export const TORRENT_LABEL = 'Torrent';
/** o torrent precisa achar peers e baixar o começo (e, em mp4, o índice no fim) antes de tocar */
export const TORRENT_START_MS = 60000;

/** Torrentio: provedores gerais e os brasileiros (dublados), por seeds, sem 3D, CAM, screener e sem qualidade */
const TORRENTIO =
  'https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,comando,bludv,micoleaodublado%7Csort=seeders%7Cqualityfilter=threed,scr,cam,unknown';

/** motor que não responde nisso está fora do ar */
const HEALTH_TIMEOUT_MS = 1200;
/** a resposta do motor vale por esse tempo */
const HEALTH_TTL_MS = 30000;
/** na TV, o serviço do motor tem esse tempo para responder depois de subir */
const SERVICE_START_MS = 12000;
/** torrents tentados antes de desistir (um sem peers trava a lista de arquivos) */
const TRIES = 3;

let health: { at: number; ok: Promise<boolean> } | null = null;
/** na TV, o pedido para subir o serviço do motor (uma vez por abertura do app) */
let service: Promise<boolean> | null = null;

function probe(): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => resolve(false), HEALTH_TIMEOUT_MS);
    fetch(`${ENGINE}/health`, { cache: 'no-store' })
      .then((r) => r.json())
      .then(
        (body: { ok?: boolean }) => {
          window.clearTimeout(timer);
          resolve(!!body && body.ok === true);
        },
        () => {
          window.clearTimeout(timer);
          resolve(false);
        },
      );
  });
}

/** Na TV o motor é um serviço do app: sobe e espera ele responder. */
async function startOnTv(): Promise<boolean> {
  if (!(await startTorrentService())) return false;
  const until = Date.now() + SERVICE_START_MS;
  while (Date.now() < until) {
    if (await probe()) return true;
    await new Promise((r) => window.setTimeout(r, 450));
  }
  return false;
}

/** O motor local está no ar? (resposta guardada por alguns segundos) */
export function torrentAvailable(): Promise<boolean> {
  // site em https não pode chamar http://127.0.0.1 (conteúdo misto)
  if (window.location.protocol === 'https:') return Promise.resolve(false);
  if (health && Date.now() - health.at < HEALTH_TTL_MS) return health.ok;
  const ok = probe().then((up) => {
    if (up || !isTizen()) return up;
    // serviço fora do ar (primeira vez ou caiu): pede para subir de novo
    if (!service) {
      service = startOnTv().then((started) => {
        service = null;
        return started;
      });
    }
    return service;
  });
  health = { at: Date.now(), ok };
  return ok;
}

interface TorrentioStream extends AddonStream {
  fileIdx?: number;
  sources?: string[];
}

/** "👤 4762" no texto do Torrentio */
const SEEDS = /👤\s*(\d+)/;

function toTorrent(s: TorrentioStream): TorrentStream | null {
  if (!s.infoHash) return null;
  // o parse lê resolução, tamanho, idioma e codec do texto; o endereço é do motor
  const parsed = parseStream({ ...s, url: `${ENGINE}/${s.infoHash}` }, TORRENT_LABEL);
  const text = `${s.name ?? ''}\n${s.title ?? ''}\n${s.description ?? ''}`;
  const seeds = SEEDS.exec(text);
  const torrent: TorrentStream = {
    ...parsed,
    base: 'torrent',
    infoHash: s.infoHash.toLowerCase(),
    fileIdx: typeof s.fileIdx === 'number' ? s.fileIdx : undefined,
    trackers: (s.sources ?? []).filter((t) => t.indexOf('tracker:') === 0).map((t) => t.slice('tracker:'.length)),
    seeds: seeds ? Number(seeds[1]) : 0,
  };
  // o Torrentio põe o nome do release na primeira linha do título
  rememberRelease(torrent, { ...s, title: (s.title || '').split('\n')[0] });
  return torrent;
}

/**
 * O título não está em nenhum streaming no Brasil (assinatura ou grátis)? Aí as
 * fontes HTTP costumam ser fracas ou nem existir, e o torrent vem primeiro. O
 * motor pergunta ao JustWatch; sem resposta, fica como antes (false).
 */
export async function noStreamingInBrazil(title: Title): Promise<boolean> {
  const imdb = title.imdbId ?? (/^tt\d+$/.test(title.id) ? title.id : null);
  if (!imdb) return false;
  const ask = async (q: string) =>
    (
      await getJson<{ streaming: boolean | null }>(
        `${ENGINE}/streaming-br?imdb=${imdb}&type=${title.type}&q=${encodeURIComponent(q)}`,
      )
    ).streaming;
  try {
    let streaming = await ask(title.title);
    if (streaming === null && title.originalTitle && title.originalTitle !== title.title) {
      streaming = await ask(title.originalTitle);
    }
    return streaming === false;
  } catch {
    return false;
  }
}

/** Os torrents do título, do melhor para o pior, sem gravação de cinema. */
export async function findTorrents(title: Title, season?: number, episode?: number): Promise<TorrentStream[]> {
  const imdb = title.imdbId ?? (/^tt\d+$/.test(title.id) ? title.id : null);
  if (!imdb) return [];
  const videoId = season != null && episode != null ? `${imdb}:${season}:${episode}` : imdb;
  const [streams, speed] = await Promise.all([fetchStreams(TORRENTIO, title.type, videoId), getSpeed()]);
  const torrents = (streams as TorrentioStream[]).map(toTorrent).filter((t): t is TorrentStream => !!t);
  return rankTorrents(torrents, {
    mbps: speed.mbps,
    audio: getSettings().audio,
    originalLanguage: title.originalLanguage,
    runtime: title.runtime,
    canPlay: deviceCanPlay,
  });
}

/*
 * Torrent aberto ocupa memória e disco da TV. Cada <video> ligado a um endereço
 * do motor segura o torrent; solto por todos, ele sai do motor. Os que abriram
 * e nenhum vídeo usou (detalhes deixados antes, episódio só focado) saem na
 * varredura ao deixar os detalhes. Endereço antigo pedido de novo: o motor
 * reabre sozinho.
 */
const opened: Record<string, boolean> = {};
const holds: Record<string, number> = {};
/** solto e religado logo (troca de fonte, player adotando o vídeo) não sai do motor */
const DROP_DELAY_MS = 5000;

function hashOf(url: string): string | null {
  if (url.indexOf(`${ENGINE}/`) !== 0) return null;
  const m = /^([0-9a-f]{40})\//.exec(url.slice(ENGINE.length + 1));
  return m ? m[1] : null;
}

function removeFromEngine(hash: string) {
  delete opened[hash];
  fetch(`${ENGINE}/${hash}/remove`, { cache: 'no-store' }).catch(() => undefined);
}

/** Um vídeo passou a tocar este endereço. */
export function holdTorrent(url: string) {
  const hash = hashOf(url);
  if (hash) holds[hash] = (holds[hash] || 0) + 1;
}

/** O vídeo soltou o endereço: ninguém mais usando, o torrent sai do motor. */
export function dropTorrent(url: string) {
  const hash = hashOf(url);
  if (!hash || !holds[hash]) return;
  holds[hash] -= 1;
  if (holds[hash]) return;
  delete holds[hash];
  window.setTimeout(() => !holds[hash] && removeFromEngine(hash), DROP_DELAY_MS);
}

/** Tira do motor os torrents abertos que nenhum vídeo está usando. */
export function sweepTorrents() {
  Object.keys(opened).forEach((hash) => !holds[hash] && removeFromEngine(hash));
}

/** Abre o torrent no motor e devolve o endereço do vídeo dentro dele. */
async function openInEngine(t: TorrentStream, season?: number, episode?: number): Promise<string> {
  const params: string[] = [];
  if (t.fileIdx != null) params.push(`fileIdx=${t.fileIdx}`);
  if (season != null && episode != null) params.push(`s=${season}`, `e=${episode}`);
  t.trackers.forEach((tr) => params.push(`tr=${encodeURIComponent(tr)}`));
  // torrent sem peers não entrega a lista de arquivos: o tempo limite do getJson passa para o próximo
  const created = await getJson<{ fileIdx?: number; error?: string }>(
    `${ENGINE}/${t.infoHash}/create?${params.join('&')}`,
  );
  if (created.fileIdx == null) throw new Error(created.error || 'sem arquivo de vídeo');
  opened[t.infoHash] = true;
  return `${ENGINE}/${t.infoHash}/${created.fileIdx}`;
}

/**
 * A fonte "Torrent" pronta para o player: o melhor torrent que o motor
 * conseguiu abrir. Null quando não há torrent ou nenhum abriu.
 */
export async function torrentCandidate(
  title: Title,
  season?: number,
  episode?: number,
  /** só torrents que passam aqui (ex.: com o áudio escolhido) */
  accept?: (t: TorrentStream) => boolean,
): Promise<Candidate | null> {
  const list = (await findTorrents(title, season, episode)).filter((t) => !accept || accept(t));
  for (const t of list.slice(0, TRIES)) {
    try {
      const url = await openInEngine(t, season, episode);
      return {
        url,
        hls: false,
        label: TORRENT_LABEL,
        profile: { base: 'torrent', label: TORRENT_LABEL, languages: t.languages, multiAudio: t.multiAudio, dualAudio: t.dualAudio },
        hardSubs: !!t.hardSubs,
        release: releaseOf(t),
        torrent: { infoHash: t.infoHash, seeds: t.seeds, resolution: t.resolution },
      };
    } catch {
      // sem peers ou sem vídeo: o próximo, e este não fica baixando metadados à toa
      if (!holds[t.infoHash]) removeFromEngine(t.infoHash);
    }
  }
  return null;
}

/** Como o torrent em tela está: quanto já tem à frente do ponto pedido, em segundos de vídeo. */
export interface TorrentBuffer {
  /** segundos de vídeo prontos em sequência a partir do ponto */
  aheadS: number;
  /** o arquivo está pronto até o fim a partir do ponto */
  toEnd: boolean;
  /** tudo o que o motor já baixou deste torrent, em segundos de vídeo (mostra que está andando) */
  downloadedS: number;
  peers: number;
  /** bytes por segundo */
  speed: number;
}

/** Pergunta ao motor quanto do vídeo `url` está pronto a partir de `atS` (duração `lengthS`). */
export async function torrentBuffer(url: string, atS: number, lengthS: number): Promise<TorrentBuffer | null> {
  if (!hashOf(url) || !(lengthS > 0)) return null;
  const pos = Math.max(0, Math.min(1, atS / lengthS));
  const s = await getJson<{ ahead: number; downloaded: number; peers: number; downloadSpeed: number; length: number }>(
    `${url}/stats.json?pos=${pos.toFixed(6)}`,
    4000,
  );
  // motor de versão antiga não diz o que tem à frente
  if (typeof s.ahead !== 'number' || !(s.length > 0)) return null;
  // bytes viram segundos pela taxa média do arquivo
  const bytesPerS = s.length / lengthS;
  return {
    aheadS: bytesPerS > 0 ? s.ahead / bytesPerS : 0,
    toEnd: pos * s.length + s.ahead >= s.length - 1,
    downloadedS: bytesPerS > 0 ? (s.downloaded || 0) / bytesPerS : 0,
    peers: s.peers,
    speed: s.downloadSpeed,
  };
}
