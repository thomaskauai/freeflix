// Torrent como fonte opcional do player ("Torrent" no menu de fontes).
//
// O app não fala BitTorrent: quem baixa é o motor local (torrent-engine/), um
// Node que serve o vídeo por HTTP em 127.0.0.1:2710 enquanto baixa. No Mac ele
// roda com `npm start` em torrent-engine/; na TV, como serviço do app. Sem o
// motor no ar (site em https, celular), a opção nem aparece.
//
// Os torrents vêm do Torrentio, já ordenados por seeds e sem CAM/screener. Daqui
// sai um só: o que o aparelho toca, na qualidade que a rede aguenta, no idioma
// preferido e com mais seeds. Gravação de cinema fica de fora de qualquer jeito.
import { fetchStreams, getJson, type AddonStream } from '../data/addonClient';
import type { Title } from '../data/types';
import { getSettings } from '../settings';
import { getSpeed } from './network';
import { parseStream } from './parse';
import { rankTorrents, type TorrentStream } from './rank';
import { deviceCanPlay, type Candidate } from './resolve';

export const ENGINE = 'http://127.0.0.1:2710';
export const TORRENT_LABEL = 'Torrent';

/** Torrentio: provedores gerais e os brasileiros (dublados), por seeds, sem 3D, CAM, screener e sem qualidade */
const TORRENTIO =
  'https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,comando,bludv,micoleaodublado%7Csort=seeders%7Cqualityfilter=threed,scr,cam,unknown';

/** motor que não responde nisso está fora do ar */
const HEALTH_TIMEOUT_MS = 1200;
/** a resposta do motor vale por esse tempo */
const HEALTH_TTL_MS = 30000;
/** torrents tentados antes de desistir (um sem peers trava a lista de arquivos) */
const TRIES = 3;

let health: { at: number; ok: Promise<boolean> } | null = null;

/** O motor local está no ar? (resposta guardada por alguns segundos) */
export function torrentAvailable(): Promise<boolean> {
  // site em https não pode chamar http://127.0.0.1 (conteúdo misto)
  if (window.location.protocol === 'https:') return Promise.resolve(false);
  if (health && Date.now() - health.at < HEALTH_TTL_MS) return health.ok;
  const ok = new Promise<boolean>((resolve) => {
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
  return {
    ...parsed,
    base: 'torrent',
    infoHash: s.infoHash.toLowerCase(),
    fileIdx: typeof s.fileIdx === 'number' ? s.fileIdx : undefined,
    trackers: (s.sources ?? []).filter((t) => t.indexOf('tracker:') === 0).map((t) => t.slice('tracker:'.length)),
    seeds: seeds ? Number(seeds[1]) : 0,
  };
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
  return `${ENGINE}/${t.infoHash}/${created.fileIdx}`;
}

/**
 * A fonte "Torrent" pronta para o player: o melhor torrent que o motor
 * conseguiu abrir. Null quando não há torrent ou nenhum abriu.
 */
export async function torrentCandidate(title: Title, season?: number, episode?: number): Promise<Candidate | null> {
  const list = await findTorrents(title, season, episode);
  for (const t of list.slice(0, TRIES)) {
    try {
      const url = await openInEngine(t, season, episode);
      return {
        url,
        hls: false,
        label: TORRENT_LABEL,
        profile: { base: 'torrent', label: TORRENT_LABEL, languages: t.languages, multiAudio: t.multiAudio },
        hardSubs: !!t.hardSubs,
        torrent: { infoHash: t.infoHash, seeds: t.seeds, resolution: t.resolution },
      };
    } catch {
      // sem peers ou sem vídeo: o próximo
    }
  }
  return null;
}
