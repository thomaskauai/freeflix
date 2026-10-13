import { fetchStreams } from '../data/addonClient';
import type { Title } from '../data/types';
import { getSettings } from '../settings';
import { getSpeed } from './network';
import { parseStream, type ParsedStream } from './parse';
import { describeStream, hasOriginalAudio, rankStreams, type RankContext } from './rank';
import { listSources, type SourceAddon } from './sources';

export interface Candidate {
  url: string;
  hls: boolean;
  /** resumo da fonte para o espectador; espelhos do mesmo arquivo têm o mesmo */
  label: string;
}

export type NoSourceReason =
  /** nenhum addon de fonte instalado */
  | 'no-addons'
  /** os addons responderam, mas nenhum tem este título */
  | 'not-found'
  /** só vieram fontes de torrent, que este app não toca */
  | 'torrent-only'
  /** nenhum addon respondeu */
  | 'unreachable';

export type Resolution = { candidates: Candidate[] } | { reason: NoSourceReason };

/** quantas fontes o player guarda para tentar em sequência */
const MAX_CANDIDATES = 12;
/**
 * Uma fonte costuma devolver vários espelhos do mesmo arquivo (mesma resolução
 * e idioma, servidores diferentes). Alguns ficam como reserva; o resto só
 * tiraria o lugar de opções realmente diferentes.
 */
const MAX_MIRRORS = 3;

const accepts = (addon: SourceAddon, type: string, id: string) =>
  (addon.types.length === 0 || addon.types.indexOf(type) >= 0) &&
  (addon.idPrefixes.length === 0 || addon.idPrefixes.some((prefix) => id.indexOf(prefix) === 0));

function deviceCanPlay(what: 'hevc' | 'av1' | 'mkv'): boolean {
  const probe = document.createElement('video');
  const mime =
    what === 'hevc'
      ? 'video/mp4; codecs="hvc1.1.6.L93.B0"'
      : what === 'av1'
        ? 'video/mp4; codecs="av01.0.05M.08"'
        : 'video/x-matroska; codecs="avc1.640028"';
  return probe.canPlayType(mime) !== '';
}

/**
 * Pergunta a todos os addons instalados pelas fontes de um título (ou
 * episódio) e devolve as melhores, já em ordem, sem o espectador escolher.
 */
export async function resolvePlayback(title: Title, season?: number, episode?: number): Promise<Resolution> {
  const videoId = season != null && episode != null ? `${title.id}:${season}:${episode}` : title.id;
  const addons = listSources().filter((a) => accepts(a, title.type, title.id));
  if (listSources().length === 0) return { reason: 'no-addons' };
  if (addons.length === 0) return { reason: 'not-found' };

  let answered = 0;
  const [lists, speed] = await Promise.all([
    Promise.all(
      addons.map((addon) =>
        fetchStreams(addon.base, title.type, videoId).then(
          (streams) => {
            answered++;
            return streams.map((s) => parseStream(s, addon.name));
          },
          () => [] as ParsedStream[],
        ),
      ),
    ),
    getSpeed(),
  ]);
  if (answered === 0) return { reason: 'unreachable' };

  const all = ([] as ParsedStream[]).concat(...lists);
  const context: RankContext = {
    mbps: speed.mbps,
    audio: getSettings().audio,
    originalLanguage: title.originalLanguage,
    runtime: title.runtime,
    canPlay: deviceCanPlay,
  };
  const ranked = rankStreams(all, context);
  if (ranked.length === 0) {
    return { reason: all.some((s) => s.unplayable === 'torrent') ? 'torrent-only' : 'not-found' };
  }
  const toCandidate = (s: ParsedStream): Candidate => ({
    url: s.url as string,
    hls: s.container === 'hls',
    label: describeStream(s),
  });

  const kept: ParsedStream[] = [];
  const mirrors: Record<string, number> = {};
  for (const s of ranked) {
    if (kept.length >= MAX_CANDIDATES) break;
    const label = describeStream(s);
    mirrors[label] = (mirrors[label] ?? 0) + 1;
    if (mirrors[label] > MAX_MIRRORS) continue;
    kept.push(s);
  }

  // Com um idioma preferido, as dubladas podem ocupar a lista inteira. A melhor
  // fonte no idioma original entra sempre, para dar a opção de trocar.
  const original = (s: ParsedStream) => hasOriginalAudio(s, title.originalLanguage);
  if (!kept.some(original)) {
    const best = ranked.filter(original)[0];
    if (best) {
      if (kept.length >= MAX_CANDIDATES) kept.pop();
      kept.push(best);
    }
  }
  return { candidates: kept.map(toCandidate) };
}
