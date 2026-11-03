import { fetchMeta, fetchStreams } from '../data/addonClient';
import { CATALOG } from '../settings';
import type { Title, TitleType } from '../data/types';
import { audioFor } from './audioMemory';
import { getSpeed } from './network';
import { parseStream, type ParsedStream } from './parse';
import {
  describeStream,
  foreignOnly,
  isBackupSource,
  offersAudio,
  pickStreams,
  rankStreams,
  wrongDuration,
  type RankContext,
  type SourceProfile,
} from './rank';
import { installDefaultSources, listSources, servesLanguage, sourcePriority, type SourceAddon } from './sources';
import { releaseOf, rememberRelease } from './subtitles';

export interface Candidate {
  url: string;
  hls: boolean;
  /** resumo da fonte para o espectador; espelhos do mesmo arquivo têm o mesmo */
  label: string;
  /** de onde veio e que áudio tem: o próximo episódio procura igual */
  profile: SourceProfile;
  /** a legenda já vem gravada no vídeo: o app não liga a dele sozinho */
  hardSubs?: boolean;
  /** nome do arquivo (release), para buscar a legenda da mesma versão */
  release?: string;
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

/**
 * Passado esse tempo, o play sai com as fontes que já responderam (os addons
 * rápidos levam menos de 1 s; alguns levam 10 s ou mais). Os lentos entram
 * depois como reserva.
 */
const QUICK_MS = 2500;
/** passado isso, o que já chegou (mesmo sem o áudio escolhido) toca; o resto vem como reserva */
const ENOUGH_MS = 16000;

const accepts = (addon: SourceAddon, type: string, id: string) =>
  (addon.types.length === 0 || addon.types.indexOf(type) >= 0) &&
  (addon.idPrefixes.length === 0 || addon.idPrefixes.some((prefix) => id.indexOf(prefix) === 0));

/**
 * Nome do título no catálogo em inglês ("Spirited Away" para A Viagem de
 * Chihiro), para reconhecer arquivos de release. O catálogo em inglês já veio
 * nos detalhes, então costuma estar em cache.
 */
export function englishName(title: Title): Promise<string> {
  return CATALOG.fallback
    ? fetchMeta(CATALOG.fallback, title.type, title.id).then(
        (meta) => (meta ? meta.name : ''),
        () => '',
      )
    : Promise.resolve('');
}

/**
 * Pede as fontes de um título (ou episódio) aos addons sem esperar o título
 * completo: o /meta do catálogo leva de meio a alguns segundos, e as fontes só
 * dependem do id. resolvePlayback, quando o título chegar, recebe a mesma
 * resposta (addonClient guarda por alguns segundos), já pronta ou a caminho.
 */
export function warmStreams(
  type: TitleType,
  id: string,
  season?: number,
  episode?: number,
  originalLanguage?: string,
) {
  const videoId = season != null && episode != null ? `${id}:${season}:${episode}` : id;
  listSources()
    .filter((a) => accepts(a, type, id) && servesLanguage(a, originalLanguage))
    .forEach((a) => fetchStreams(a.base, type, videoId).catch(() => undefined));
}

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
  const found = await resolveOnce(title, season, episode, options);
  if (!('reason' in found) || options.only) return found;
  // Sem fonte: uma fonte nova da lista (BestCine, por exemplo) pode estar
  // entrando agora, ao abrir o app. Espera ela entrar e pergunta de novo.
  const before = listSources().map((a) => a.base).join(' ');
  await Promise.race([
    installDefaultSources().catch(() => undefined),
    new Promise((r) => window.setTimeout(r, INSTALL_WAIT_MS)),
  ]);
  if (listSources().map((a) => a.base).join(' ') === before) return found;
  return resolveOnce(title, season, episode, options);
}

/** quanto o "sem fonte" espera uma fonte nova da lista terminar de entrar */
const INSTALL_WAIT_MS = 8000;

async function resolveOnce(
  title: Title,
  season: number | undefined,
  episode: number | undefined,
  options: ResolveOptions,
): Promise<Resolution> {
  const videoId = season != null && episode != null ? `${title.id}:${season}:${episode}` : title.id;
  // Na primeira abertura as fontes padrão podem ainda estar entrando. Já
  // instaladas, a lista remota atualiza em segundo plano, sem segurar o play.
  const installing = installDefaultSources();
  if (listSources().length === 0) await installing;
  const addons = listSources().filter(
    (a) =>
      accepts(a, title.type, title.id) &&
      servesLanguage(a, title.originalLanguage) &&
      (!options.only || a.base === options.only),
  );
  if (listSources().length === 0) return { reason: 'no-addons' };
  if (addons.length === 0) return { reason: 'not-found' };

  const english = englishName(title);
  let answered = 0;
  let pending = addons.length;
  // sem contar a fonte reserva (BestCine): com as outras respondidas e algo tocável, não espera por ela
  let mainPending = addons.filter((a) => !isBackupSource(a)).length;
  const lists: ParsedStream[][] = addons.map(() => []);
  let arrived: () => void = () => undefined;
  const all = Promise.all(
    addons.map((addon, i) =>
      Promise.all([fetchStreams(addon.base, title.type, videoId), english]).then(
        ([streams, englishName]) => {
          const names = [title.title, title.originalTitle ?? '', englishName];
          answered++;
          const priority = sourcePriority(addon, listSources());
          lists[i] = streams.map((s) => {
            const parsed = { ...parseStream(s, addon.name, names), priority, base: addon.base };
            // filme com arquivo de duração bem diferente da do catálogo: outro título
            if (title.type === 'movie' && !parsed.unplayable && wrongDuration(parsed, title.runtime))
              parsed.unplayable = 'other-title';
            rememberRelease(parsed, s);
            return parsed;
          });
        },
        () => undefined,
      ).then(() => {
        pending--;
        if (!isBackupSource(addon)) mainPending--;
        arrived();
      }),
    ),
  );
  // a medida de rede não segura o play (streams/network.ts)
  const speed = await getSpeed();
  const rank = () => rankAll(([] as ParsedStream[]).concat(...lists), title, speed.mbps, options);

  // Espera todos, ou só os que chegaram até QUICK_MS se a melhor fonte já tem o áudio escolhido.
  const audio = { audio: audioFor(title), originalLanguage: title.originalLanguage };
  const ready = () => {
    const ranked = rank();
    return ranked.length > 0 && offersAudio(ranked[0], audio);
  };
  let quick = false;
  let enough = false;
  const timer = window.setTimeout(() => {
    quick = true;
    arrived();
  }, QUICK_MS);
  // fonte lenta (até 45 s) só segura o play quando nenhuma outra tem o título
  const cap = window.setTimeout(() => {
    enough = true;
    arrived();
  }, ENOUGH_MS);
  await new Promise<void>((done) => {
    arrived = () => {
      if (pending === 0 || (quick && ready()) || ((enough || mainPending === 0) && rank().length > 0)) done();
    };
    arrived();
  });
  window.clearTimeout(timer);
  window.clearTimeout(cap);

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
    audio: audioFor(title),
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
    profile: {
      base: s.base ?? '',
      label,
      languages: s.languages,
      multiAudio: s.multiAudio,
      dualAudio: s.dualAudio,
      ...(s.exactLanguages ? { exactLanguages: true } : {}),
    },
    hardSubs: !!s.hardSubs,
    release: releaseOf(s),
  };
}

function pick(ranked: ParsedStream[], title: Title): ParsedStream[] {
  return pickStreams(ranked, { audio: audioFor(title), originalLanguage: title.originalLanguage });
}
