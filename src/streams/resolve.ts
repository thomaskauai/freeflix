import { fetchStreams } from '../data/addonClient';
import type { Title } from '../data/types';
import { getSettings } from '../settings';
import { getSpeed } from './network';
import { parseStream, type ParsedStream } from './parse';
import { audioChoice, describeStream, foreignOnly, offersAudio, rankStreams, type RankContext, type SourceProfile } from './rank';
import { installDefaultSources, listSources, sourcePriority, type SourceAddon } from './sources';

export interface Candidate {
  url: string;
  hls: boolean;
  /** resumo da fonte para o espectador; espelhos do mesmo arquivo têm o mesmo */
  label: string;
  /** de onde veio e que áudio tem: o próximo episódio procura igual */
  profile: SourceProfile;
  /** a legenda já vem gravada no vídeo: o app não liga a dele sozinho */
  hardSubs?: boolean;
  /** fonte "Torrent": o vídeo sai do motor local (streams/torrent.ts) */
  torrent?: { infoHash: string; seeds: number; resolution: number };
}

export interface ResolveOptions {
  /** fonte escolhida antes neste título: vem primeiro */
  prefer?: SourceProfile;
  /** pergunta só a este addon (endereço base) */
  only?: string;
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

export type Resolution =
  | {
      candidates: Candidate[];
      /** addons lentos ainda respondendo: a lista completa, já com estas, quando chegarem */
      later?: Promise<Candidate[]>;
    }
  | { reason: NoSourceReason };

/** quantas fontes o player guarda para tentar em sequência */
const MAX_CANDIDATES = 12;
/**
 * Uma fonte costuma devolver vários espelhos do mesmo arquivo (mesma resolução
 * e idioma, servidores diferentes). Alguns ficam como reserva; o resto só
 * tiraria o lugar de opções realmente diferentes.
 */
const MAX_MIRRORS = 3;
/** áudios a mais (um de cada) além da lista, para dar o que escolher no player */
const MAX_EXTRA_AUDIOS = 4;
/**
 * Passado esse tempo, o play sai com as fontes que já responderam (os addons
 * rápidos levam menos de 1 s; alguns levam 10 s ou mais). Os lentos entram
 * depois como reserva.
 */
const QUICK_MS = 2500;

const accepts = (addon: SourceAddon, type: string, id: string) =>
  (addon.types.length === 0 || addon.types.indexOf(type) >= 0) &&
  (addon.idPrefixes.length === 0 || addon.idPrefixes.some((prefix) => id.indexOf(prefix) === 0));

/** O <video> deste aparelho toca esse codec ou contêiner? */
export function deviceCanPlay(what: 'hevc' | 'av1' | 'mkv'): boolean {
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
export async function resolvePlayback(
  title: Title,
  season?: number,
  episode?: number,
  options: ResolveOptions = {},
): Promise<Resolution> {
  const videoId = season != null && episode != null ? `${title.id}:${season}:${episode}` : title.id;
  // Na primeira abertura as fontes padrão podem ainda estar entrando. Já
  // instaladas, a lista remota atualiza em segundo plano, sem segurar o play.
  const installing = installDefaultSources();
  if (listSources().length === 0) await installing;
  const addons = listSources().filter(
    (a) => accepts(a, title.type, title.id) && (!options.only || a.base === options.only),
  );
  if (listSources().length === 0) return { reason: 'no-addons' };
  if (addons.length === 0) return { reason: 'not-found' };

  let answered = 0;
  let pending = addons.length;
  const lists: ParsedStream[][] = addons.map(() => []);
  let arrived: () => void = () => undefined;
  const all = Promise.all(
    addons.map((addon, i) =>
      fetchStreams(addon.base, title.type, videoId).then(
        (streams) => {
          answered++;
          const priority = sourcePriority(addon, listSources());
          lists[i] = streams.map((s) => ({ ...parseStream(s, addon.name), priority, base: addon.base }));
        },
        () => undefined,
      ).then(() => {
        pending--;
        arrived();
      }),
    ),
  );
  // a medida de rede não segura o play (streams/network.ts)
  const speed = await getSpeed();
  const rank = () => rankAll(([] as ParsedStream[]).concat(...lists), title, speed.mbps, options);

  // Espera todos, ou só os que chegaram até QUICK_MS se a melhor fonte já tem o áudio escolhido.
  const audio = { audio: getSettings().audio, originalLanguage: title.originalLanguage };
  const ready = () => {
    const ranked = rank();
    return ranked.length > 0 && offersAudio(ranked[0], audio);
  };
  let quick = false;
  const timer = window.setTimeout(() => {
    quick = true;
    arrived();
  }, QUICK_MS);
  await new Promise<void>((done) => {
    arrived = () => {
      if (pending === 0 || (quick && ready())) done();
    };
    arrived();
  });
  window.clearTimeout(timer);

  if (pending > 0) {
    return {
      candidates: pick(rank(), title).map(toCandidate),
      later: all.then(() => pick(rank(), title).map(toCandidate)),
    };
  }
  if (answered === 0) return { reason: 'unreachable' };
  const ranked = rank();
  if (ranked.length === 0) {
    const flat = ([] as ParsedStream[]).concat(...lists);
    return { reason: flat.some((s) => s.unplayable === 'torrent') ? 'torrent-only' : 'not-found' };
  }
  return { candidates: pick(ranked, title).map(toCandidate) };
}

function rankAll(all: ParsedStream[], title: Title, mbps: number, options: ResolveOptions): ParsedStream[] {
  const context: RankContext = {
    mbps,
    audio: getSettings().audio,
    originalLanguage: title.originalLanguage,
    runtime: title.runtime,
    canPlay: deviceCanPlay,
    prefer: options.prefer,
  };
  // Dublagem só em outro idioma (russo, francês…) fica de fora, a não ser que seja o que há.
  const playable = rankStreams(all, context);
  const wanted = playable.filter((s) => !foreignOnly(s, context));
  return wanted.length ? wanted : playable;
}

function toCandidate(s: ParsedStream): Candidate {
  const label = describeStream(s);
  return {
    url: s.url as string,
    hls: s.container === 'hls',
    label,
    profile: { base: s.base ?? '', label, languages: s.languages, multiAudio: s.multiAudio, dualAudio: s.dualAudio },
    hardSubs: !!s.hardSubs,
  };
}

function pick(ranked: ParsedStream[], title: Title): ParsedStream[] {
  const kept: ParsedStream[] = [];
  const mirrors: Record<string, number> = {};
  for (const s of ranked) {
    if (kept.length >= MAX_CANDIDATES) break;
    const label = describeStream(s);
    mirrors[label] = (mirrors[label] ?? 0) + 1;
    if (mirrors[label] > MAX_MIRRORS) continue;
    kept.push(s);
  }

  // Um áudio pode ocupar a lista inteira (as dubladas, com um idioma preferido,
  // ou o original). A melhor fonte de cada áudio entra sempre, para o player
  // oferecer a troca, como a Netflix.
  const audioKey = (s: ParsedStream) => audioChoice(s, title.originalLanguage).key;
  const present = kept.map(audioKey);
  ranked.forEach((s) => {
    const k = audioKey(s);
    if (present.indexOf(k) >= 0 || present.length >= MAX_CANDIDATES + MAX_EXTRA_AUDIOS) return;
    present.push(k);
    kept.push(s);
  });
  return kept;
}
