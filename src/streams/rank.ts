import type { AudioLanguage } from '../settings';
import type { ParsedStream } from './parse';

/**
 * A fonte que tocou num episódio, para o próximo começar igual: mesmo addon,
 * mesma opção (resolução e áudio) e, na falta dela, o mesmo áudio.
 */
export interface SourceProfile {
  /** endereço base do addon */
  base: string;
  /** describeStream da fonte */
  label: string;
  languages: string[];
  multiAudio: boolean;
  dualAudio?: boolean;
  /** idiomas da linha ff: (lista completa; parse.ts) */
  exactLanguages?: boolean;
}

/** O que a fonte diz do áudio. */
type AudioInfo = { languages: string[]; multiAudio: boolean; dualAudio?: boolean; exactLanguages?: boolean };

/** "multi" que pode esconder idioma: o original fica implícito (não vale para lista exata) */
const vagueMulti = (s: AudioInfo) => s.multiAudio && !s.exactLanguages;

/**
 * Idiomas da fonte, completando o que "dual"/"multi" deixa implícito: "Dual
 * Áudio" de release brasileiro é português e o original; "multi" traz o original.
 */
export function effectiveLanguages(s: AudioInfo, originalLanguage?: string): string[] {
  if (!vagueMulti(s)) return s.languages;
  const languages = s.languages.length ? s.languages.slice() : s.dualAudio ? ['pt'] : [];
  if (originalLanguage && languages.indexOf(originalLanguage) < 0) languages.push(originalLanguage);
  return languages;
}

export interface RankContext {
  /** banda medida, em Mbps */
  mbps: number;
  audio: AudioLanguage;
  /** idioma original da obra (en, ja…), quando o catálogo informa */
  originalLanguage?: string;
  /** duração em minutos, para estimar o bitrate a partir do tamanho */
  runtime?: number;
  /** o aparelho declara suporte? (injetável para teste) */
  canPlay: (what: 'hevc' | 'av1' | 'mkv') => boolean;
  /** fonte escolhida no episódio anterior: vale mais que qualquer outro critério */
  prefer?: SourceProfile;
}

/** fração da banda medida que um vídeo pode ocupar sem engasgar */
const HEADROOM = 0.8;
const UHD_MBPS = 25;

/** Maior resolução que a rede medida aguenta. */
export function resolutionCap(mbps: number): number {
  if (mbps < 5) return 480;
  if (mbps < 10) return 720;
  if (mbps < UHD_MBPS) return 1080;
  return 2160;
}

function fitsNetwork(s: ParsedStream, ctx: RankContext): boolean {
  if (s.resolution > resolutionCap(ctx.mbps)) return false;
  if (s.sizeBytes > 0 && ctx.runtime) {
    const needed = (s.sizeBytes * 8) / (ctx.runtime * 60) / 1e6;
    if (needed > ctx.mbps * HEADROOM) return false;
  }
  return true;
}

/**
 * A fonte traz só o áudio original? Sem marca de idioma no texto, ou marcada
 * apenas com o idioma original da obra. "Dual"/"multi" não conta: ali o
 * original divide espaço com uma dublagem, e qual toca primeiro varia.
 */
export function hasOriginalAudio(s: ParsedStream, originalLanguage?: string): boolean {
  if (s.multiAudio) return false;
  if (s.languages.length === 0) return true;
  return !!originalLanguage && s.languages.length === 1 && s.languages[0] === originalLanguage;
}

/**
 * A fonte tem com certeza o áudio escolhido nas Configurações? O idioma
 * marcado, ou o original quando o escolhido é o original (ou já é o idioma da
 * obra). "Multi" sem dizer quais não conta: no ranking é provável, aqui não basta.
 */
export function offersAudio(s: AudioInfo, ctx: Pick<RankContext, 'audio' | 'originalLanguage'>): boolean {
  const languages = effectiveLanguages(s, ctx.originalLanguage);
  const tagged = s.languages.length > 0;
  const hasOriginal =
    !tagged || vagueMulti(s) || (!!ctx.originalLanguage && s.languages.indexOf(ctx.originalLanguage) >= 0);
  if (ctx.audio === 'original') return hasOriginal;
  return languages.indexOf(ctx.audio) >= 0 || (ctx.originalLanguage === ctx.audio && hasOriginal);
}

/**
 * Preferido das configurações primeiro; sem preferência (ou se não houver),
 * o áudio original; depois inglês; depois o resto.
 */
function languageTier(s: ParsedStream, ctx: RankContext): number {
  const tagged = s.languages.length > 0;
  const hasOriginal =
    !tagged || vagueMulti(s) || (!!ctx.originalLanguage && s.languages.indexOf(ctx.originalLanguage) >= 0);

  if (ctx.audio !== 'original') {
    if (effectiveLanguages(s, ctx.originalLanguage).indexOf(ctx.audio) >= 0) return 5;
    // "dual"/"multi" sem dizer quais idiomas: provável, não certo
    if (s.multiAudio && !tagged) return 4;
    // o preferido já é o idioma original da obra
    if (ctx.originalLanguage === ctx.audio && hasOriginal) return 5;
  }
  if (hasOriginal) return 3;
  if (s.languages.indexOf('en') >= 0) return 2;
  return 1;
}

/**
 * Áudio limpo: só idiomas pedidos (português, inglês, o original, o
 * preferido). Pacote com dublagem de fora (russo, híndi) ou "MULTI" sem dizer
 * quais costuma abrir na faixa estrangeira (PenguPlay: "Org.Hindi…English",
 * PrimeFix "MULTI" = híndi, tâmil, télugo e inglês por último); fica atrás do
 * inglês puro/original no mesmo nível de idioma. "Dual Áudio" sem idiomas é
 * release brasileiro (português e o original) e conta como limpo.
 */
function cleanAudioTier(s: ParsedStream, ctx: Pick<RankContext, 'audio' | 'originalLanguage'>): number {
  if (s.multiAudio && !s.languages.length) return s.dualAudio ? 1 : 0;
  const wanted = ['pt', 'en'];
  if (ctx.originalLanguage) wanted.push(ctx.originalLanguage);
  if (ctx.audio !== 'original') wanted.push(ctx.audio);
  return s.languages.some((l) => wanted.indexOf(l) < 0) ? 0 : 1;
}

/**
 * Áudio que ninguém aqui pediu: dublagem só em outro idioma (russo, francês…),
 * sem português, inglês, o original da obra ou o preferido.
 */
export function foreignOnly(s: ParsedStream, ctx: Pick<RankContext, 'audio' | 'originalLanguage'>): boolean {
  if (vagueMulti(s) || s.languages.length === 0) return false;
  const wanted = ['pt', 'en'];
  if (ctx.originalLanguage) wanted.push(ctx.originalLanguage);
  if (ctx.audio !== 'original') wanted.push(ctx.audio);
  return !s.languages.some((l) => wanted.indexOf(l) >= 0);
}

const sameAudio = (s: ParsedStream, p: SourceProfile) =>
  s.multiAudio === p.multiAudio && s.languages.slice().sort().join() === p.languages.slice().sort().join();

/** Quanto a fonte lembra a escolhida antes: mesma opção do mesmo addon, mesmo áudio no mesmo addon, mesmo áudio. */
function preferenceTier(s: ParsedStream, p?: SourceProfile): number {
  if (!p) return 0;
  const sameAddon = !!s.base && s.base === p.base;
  if (sameAddon && describeStream(s) === p.label) return 3;
  if (sameAddon && sameAudio(s, p)) return 2;
  return sameAudio(s, p) ? 1 : 0;
}

/**
 * FenixFlix: muitas fontes dela vêm com a legenda gravada no vídeo. Fora do
 * português, ela só entra quando nenhuma outra fonte tem o filme.
 */
const LAST_RESORT = /fenixflix/i;
function lastResortTier(s: ParsedStream, ctx: RankContext): number {
  return ctx.audio !== 'pt' && LAST_RESORT.test(`${s.base ?? ''} ${s.addon}`) ? 0 : 1;
}

/** Legenda gravada fica atrás das limpas, fora do português (a do app ficaria por cima). */
const cleanTier = (s: ParsedStream, ctx: RankContext) => (ctx.audio !== 'pt' && s.hardSubs ? 0 : 1);

/** 1080p é o alvo; acima dele só quando é o que há. */
function resolutionTier(resolution: number): number {
  if (resolution === 1080) return 6;
  if (resolution === 720) return 5;
  if (resolution === 1440) return 4;
  if (resolution === 2160) return 3;
  if (resolution === 0) return 2;
  if (resolution === 480) return 1;
  return 0;
}

function compatTier(s: ParsedStream, ctx: RankContext): number {
  let tier = 3;
  if (s.codec === 'hevc' && !ctx.canPlay('hevc')) tier -= 2;
  if (s.codec === 'av1' && !ctx.canPlay('av1')) tier -= 2;
  if (s.hdr) tier -= 1;
  if ((s.container === 'mkv' && !ctx.canPlay('mkv')) || s.notWebReady) tier -= 1;
  return tier;
}

/**
 * Ordena as fontes tocáveis, da melhor para a pior. A ordem dos critérios é a
 * do pedido: a escolhida no episódio anterior (se houver), caber na rede,
 * idioma, a fonte (ordem da lista padrão), resolução e compatibilidade; empate
 * total mantém a ordem de chegada. Assim, no idioma preferido, a fonte 1 ganha
 * da 2; a 2 só entra quando a 1 não tem o idioma.
 */
export function rankStreams(streams: ParsedStream[], ctx: RankContext): ParsedStream[] {
  const key = (s: ParsedStream) => {
    const fits = fitsNetwork(s, ctx);
    return [
      lastResortTier(s, ctx),
      preferenceTier(s, ctx.prefer),
      fits ? 1 : 0,
      languageTier(s, ctx),
      cleanAudioTier(s, ctx),
      cleanTier(s, ctx),
      -(s.priority ?? 0),
      // fora do que a rede aguenta, quanto menor a resolução, menos engasga
      fits ? resolutionTier(s.resolution) : -s.resolution,
      compatTier(s, ctx),
    ];
  };
  return streams
    .filter((s) => !s.unplayable && !!s.url)
    .map((s, i) => ({ s, i, k: key(s) }))
    .sort((a, b) => {
      for (let n = 0; n < a.k.length; n++) {
        if (a.k[n] !== b.k[n]) return b.k[n] - a.k[n];
      }
      return a.i - b.i;
    })
    .map((entry) => entry.s);
}

/**
 * Duração do arquivo muito diferente da do catálogo: é outro título (o PenguPlay
 * já mandou Lilo & Stitch na fonte de A Viagem de Chihiro), um trailer, uma
 * amostra ou um episódio. Só para filme, e só com folga grande: versão
 * estendida, IMAX ou corte do diretor passam de +30% e a duração do catálogo
 * às vezes erra uns minutos; abaixo de 60% ou acima de 160% já não é o filme.
 * Sem a duração do arquivo (só a linha ff: informa) ou do catálogo, nada muda.
 */
export function wrongDuration(s: Pick<ParsedStream, 'durationSec'>, runtimeMinutes?: number): boolean {
  if (!s.durationSec || !runtimeMinutes || runtimeMinutes <= 0) return false;
  const ratio = s.durationSec / 60 / runtimeMinutes;
  return ratio < 0.6 || ratio > 1.6;
}

/** Um torrent do Torrentio, já lido pelo parse. */
export interface TorrentStream extends ParsedStream {
  infoHash: string;
  /** arquivo dentro do torrent (pacote de temporada); sem ele, o motor escolhe */
  fileIdx?: number;
  trackers: string[];
  seeds: number;
}

/** com menos seeds que isso o torrent quase não baixa: só entra se não houver outro */
const MIN_SEEDS = 5;
/**
 * Torrent baixa bem menos que a banda medida (que é a das fontes HTTP): na
 * sala, ~3 Mbps com 11 peers. Acima disso, um arquivo de 15 GB nunca começa.
 */
const TORRENT_MAX_MBPS = 8;

/**
 * Ordena os torrents: o que o aparelho toca, na qualidade que a rede aguenta
 * (1080p é o alvo), no idioma preferido, com seeds suficientes e, entre
 * esses, o que tem mais seeds. Gravação de cinema e o que não toca ficam fora.
 */
export function rankTorrents(list: TorrentStream[], ctx: RankContext): TorrentStream[] {
  // resolução pela banda medida; tamanho pelo que um torrent costuma baixar
  const swarm = { ...ctx, mbps: Math.min(ctx.mbps, TORRENT_MAX_MBPS) };
  const key = (s: TorrentStream) => {
    const fits = s.resolution <= resolutionCap(ctx.mbps) && fitsNetwork({ ...s, resolution: 0 }, swarm);
    return [
      compatTier(s, ctx),
      fits ? 1 : 0,
      languageTier(s, ctx),
      cleanAudioTier(s, ctx),
      s.seeds >= MIN_SEEDS ? 1 : 0,
      fits ? resolutionTier(s.resolution) : -s.resolution,
      s.seeds,
    ];
  };
  return list
    .filter((s) => !s.unplayable)
    .map((s, i) => ({ s, i, k: key(s) }))
    .sort((a, b) => {
      for (let n = 0; n < a.k.length; n++) {
        if (a.k[n] !== b.k[n]) return b.k[n] - a.k[n];
      }
      return a.i - b.i;
    })
    .map((entry) => entry.s);
}

const LANGUAGE_LABELS: Record<string, string> = {
  pt: 'português',
  en: 'inglês',
  es: 'espanhol',
  fr: 'francês',
  de: 'alemão',
  it: 'italiano',
  ja: 'japonês',
  ko: 'coreano',
  ru: 'russo',
  hi: 'híndi',
  ta: 'tâmil',
  te: 'télugo',
  uk: 'ucraniano',
  ar: 'árabe',
};

/** Resumo de uma linha da fonte em uso, para o espectador. */
export function describeStream(s: ParsedStream): string {
  const parts: string[] = [];
  if (s.resolution) parts.push(s.resolution >= 2160 ? '4K' : `${s.resolution}p`);
  const named = s.languages.map((l) => LANGUAGE_LABELS[l] ?? l).join(' e ');
  // "dual"/"multi": a fonte diz que há mais de um áudio; os idiomas, só se ela citar
  if (s.multiAudio) parts.push(named ? `dual: ${named}` : 'mais de um áudio');
  else if (named) parts.push(named);
  else parts.push('áudio original');
  parts.push(s.addon);
  return parts.join(', ');
}

const AUDIO_NAMES: Record<string, string> = {
  pt: 'Português',
  en: 'Inglês',
  es: 'Espanhol',
  fr: 'Francês',
  it: 'Italiano',
  de: 'Alemão',
  ja: 'Japonês',
  ko: 'Coreano',
  zh: 'Chinês',
  hi: 'Híndi',
  ta: 'Tâmil',
  te: 'Télugo',
  uk: 'Ucraniano',
  ar: 'Árabe',
  ru: 'Russo',
  tr: 'Turco',
};

export const audioName = (code: string) => AUDIO_NAMES[code] ?? code.toUpperCase();

/**
 * Um áudio que dá para escolher no player: o idioma que o espectador ouve, não
 * a combinação do pacote. Uma fonte dual/multi serve a mais de um.
 */
export interface AudioChoice {
  /** "original" ou o código do idioma */
  key: string;
  label: string;
  /** idioma, quando se sabe */
  lang?: string;
  /** o áudio original da obra */
  original: boolean;
}

type AudioPrefs = Pick<RankContext, 'audio' | 'originalLanguage'>;

/** O áudio original da obra como opção do player, mesmo sem fonte carregada com ele. */
export const originalChoice = (lang?: string): AudioChoice => ({
  key: 'original',
  label: lang ? `${audioName(lang)} [original]` : 'Original',
  lang,
  original: true,
});

/** Opção de um idioma; o da obra vira a opção "[original]". */
function languageChoice(lang: string, originalLanguage?: string): AudioChoice {
  if (lang === 'original' || lang === originalLanguage) return originalChoice(originalLanguage);
  return { key: lang, label: audioName(lang), lang, original: false };
}

/** A fonte tem esse áudio? Dual/multi com ele conta. */
export function servesAudio(choice: AudioChoice, s: AudioInfo, originalLanguage?: string): boolean {
  if (choice.original) return offersAudio(s, { audio: 'original', originalLanguage });
  return !!choice.lang && offersAudio(s, { audio: choice.lang, originalLanguage });
}

/**
 * O áudio que se ouve nesta fonte: o preferido, se ela tem; senão português;
 * senão o original; senão inglês; senão o primeiro idioma dela.
 */
export function audioChoice(s: AudioInfo, originalLanguage?: string, audio: AudioLanguage = 'original'): AudioChoice {
  const preferred = languageChoice(audio, originalLanguage);
  if (servesAudio(preferred, s, originalLanguage)) return preferred;
  const languages = effectiveLanguages(s, originalLanguage);
  if (languages.indexOf('pt') >= 0) return languageChoice('pt', originalLanguage);
  if (offersAudio(s, { audio: 'original', originalLanguage })) return originalChoice(originalLanguage);
  return languageChoice(languages.indexOf('en') >= 0 ? 'en' : languages[0] || 'original', originalLanguage);
}

/** Preferência que a escolha vira: "original" ou o código do idioma. */
export const preferenceOf = (choice: AudioChoice): AudioLanguage | null =>
  choice.original ? 'original' : choice.lang || null;

/** no máximo três: o preferido, o original e o português */
const MAX_AUDIOS = 3;

/**
 * Opções de áudio do player: o preferido, o original e o português, os que
 * alguma fonte tem; híndi, tâmil e afins de pacote nunca viram opção. Com
 * `withOriginal`, o original entra mesmo sem fonte (escolhido, é procurado).
 * Nenhum deles nas fontes: o áudio de cada uma. O que está tocando entra sempre.
 */
export function audioOptions(
  sources: AudioInfo[],
  ctx: AudioPrefs,
  extra: { withOriginal?: boolean; current?: AudioChoice } = {},
): AudioChoice[] {
  const { originalLanguage } = ctx;
  let list: AudioChoice[] = [];
  const add = (c: AudioChoice) => {
    if (!list.some((a) => a.key === c.key)) list.push(c);
  };
  [languageChoice(ctx.audio, originalLanguage), originalChoice(originalLanguage), languageChoice('pt', originalLanguage)].forEach(
    (c) => {
      const loaded = sources.some((s) => servesAudio(c, s, originalLanguage));
      if (loaded || (extra.withOriginal && c.original && !!originalLanguage)) add(c);
    },
  );
  if (!list.length) sources.forEach((s) => add(audioChoice(s, originalLanguage, ctx.audio)));
  list = list.slice(0, MAX_AUDIOS);
  const current = extra.current;
  if (current && !list.some((a) => a.key === current.key)) {
    if (list.length >= MAX_AUDIOS) list.pop();
    list.push(current);
  }
  return list;
}

/** quantas fontes o player guarda para tentar em sequência */
const MAX_CANDIDATES = 12;
/**
 * Uma fonte costuma devolver vários espelhos do mesmo arquivo (mesma resolução
 * e idioma, servidores diferentes). Alguns ficam como reserva; o resto só
 * tiraria o lugar de opções realmente diferentes.
 */
const MAX_MIRRORS = 3;
/** áudios a mais (um de cada) além da lista, para os atalhos de áudio do player */
const MAX_EXTRA_AUDIOS = 4;

/**
 * As fontes que o player guarda: as com o áudio preferido (todas, se nenhuma
 * tem) e, de cada outro áudio, só a melhor, para os atalhos oferecerem a troca.
 */
export function pickStreams<T extends ParsedStream>(ranked: T[], ctx: AudioPrefs): T[] {
  const wanted = ranked.filter((s) => offersAudio(s, ctx));
  const kept: T[] = [];
  const mirrors: Record<string, number> = {};
  for (const s of wanted.length ? wanted : ranked) {
    if (kept.length >= MAX_CANDIDATES) break;
    const label = describeStream(s);
    mirrors[label] = (mirrors[label] ?? 0) + 1;
    if (mirrors[label] > MAX_MIRRORS) continue;
    kept.push(s);
  }
  const audioKey = (s: ParsedStream) => audioChoice(s, ctx.originalLanguage, ctx.audio).key;
  const present = kept.map(audioKey);
  let extras = 0;
  ranked.forEach((s) => {
    const k = audioKey(s);
    if (extras >= MAX_EXTRA_AUDIOS || present.indexOf(k) >= 0) return;
    present.push(k);
    kept.push(s);
    extras++;
  });
  return kept;
}

/** Torrents com o áudio preferido primeiro; os outros, na mesma ordem, depois. */
export function preferAudio<T extends AudioInfo>(list: T[], ctx: AudioPrefs): T[] {
  const yes = list.filter((t) => offersAudio(t, ctx));
  return yes.concat(list.filter((t) => yes.indexOf(t) < 0));
}
