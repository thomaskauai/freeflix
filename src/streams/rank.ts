import type { AudioLanguage } from "../settings";
import type { ParsedStream } from "./parse";

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
  canPlay: (what: "hevc" | "av1" | "mkv") => boolean;
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
export function hasOriginalAudio(
  s: ParsedStream,
  originalLanguage?: string,
): boolean {
  if (s.multiAudio) return false;
  if (s.languages.length === 0) return true;
  return (
    !!originalLanguage &&
    s.languages.length === 1 &&
    s.languages[0] === originalLanguage
  );
}

/**
 * A fonte tem com certeza o áudio escolhido nas Configurações? O idioma
 * marcado, ou o original quando o escolhido é o original (ou já é o idioma da
 * obra). "Multi" sem dizer quais não conta: no ranking é provável, aqui não basta.
 */
export function offersAudio(
  s: { languages: string[]; multiAudio: boolean },
  ctx: Pick<RankContext, "audio" | "originalLanguage">,
): boolean {
  const tagged = s.languages.length > 0;
  const hasOriginal =
    !tagged ||
    s.multiAudio ||
    (!!ctx.originalLanguage && s.languages.indexOf(ctx.originalLanguage) >= 0);
  if (ctx.audio === "original") return hasOriginal;
  return (
    s.languages.indexOf(ctx.audio) >= 0 ||
    (ctx.originalLanguage === ctx.audio && hasOriginal)
  );
}

/**
 * Preferido das configurações primeiro; sem preferência (ou se não houver),
 * o áudio original; depois inglês; depois o resto.
 */
function languageTier(s: ParsedStream, ctx: RankContext): number {
  const tagged = s.languages.length > 0;
  const hasOriginal =
    !tagged ||
    s.multiAudio ||
    (!!ctx.originalLanguage && s.languages.indexOf(ctx.originalLanguage) >= 0);

  if (ctx.audio !== "original") {
    if (s.languages.indexOf(ctx.audio) >= 0) return 5;
    // "dual"/"multi" sem dizer quais idiomas: provável, não certo
    if (s.multiAudio && !tagged) return 4;
    // o preferido já é o idioma original da obra
    if (ctx.originalLanguage === ctx.audio && hasOriginal) return 5;
  }
  if (hasOriginal) return 3;
  if (s.languages.indexOf("en") >= 0) return 2;
  return 1;
}

/**
 * Áudio que ninguém aqui pediu: dublagem só em outro idioma (russo, francês…),
 * sem português, inglês, o original da obra ou o preferido.
 */
export function foreignOnly(
  s: ParsedStream,
  ctx: Pick<RankContext, "audio" | "originalLanguage">,
): boolean {
  if (s.multiAudio || s.languages.length === 0) return false;
  const wanted = ["pt", "en"];
  if (ctx.originalLanguage) wanted.push(ctx.originalLanguage);
  if (ctx.audio !== "original") wanted.push(ctx.audio);
  return !s.languages.some((l) => wanted.indexOf(l) >= 0);
}

const sameAudio = (s: ParsedStream, p: SourceProfile) =>
  s.multiAudio === p.multiAudio &&
  s.languages.slice().sort().join() === p.languages.slice().sort().join();

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
  return ctx.audio !== "pt" && LAST_RESORT.test(`${s.base ?? ""} ${s.addon}`)
    ? 0
    : 1;
}

/** Legenda gravada fica atrás das limpas, fora do português (a do app ficaria por cima). */
const cleanTier = (s: ParsedStream, ctx: RankContext) =>
  ctx.audio !== "pt" && s.hardSubs ? 0 : 1;

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
  if (s.codec === "hevc" && !ctx.canPlay("hevc")) tier -= 2;
  if (s.codec === "av1" && !ctx.canPlay("av1")) tier -= 2;
  if (s.hdr) tier -= 1;
  if ((s.container === "mkv" && !ctx.canPlay("mkv")) || s.notWebReady)
    tier -= 1;
  return tier;
}

/**
 * Ordena as fontes tocáveis, da melhor para a pior. A ordem dos critérios é a
 * do pedido: a escolhida no episódio anterior (se houver), caber na rede,
 * idioma, a fonte (ordem da lista padrão), resolução e compatibilidade; empate
 * total mantém a ordem de chegada. Assim, no idioma preferido, a fonte 1 ganha
 * da 2; a 2 só entra quando a 1 não tem o idioma.
 */
export function rankStreams(
  streams: ParsedStream[],
  ctx: RankContext,
): ParsedStream[] {
  const key = (s: ParsedStream) => {
    const fits = fitsNetwork(s, ctx);
    return [
      lastResortTier(s, ctx),
      preferenceTier(s, ctx.prefer),
      fits ? 1 : 0,
      languageTier(s, ctx),
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
export function rankTorrents(
  list: TorrentStream[],
  ctx: RankContext,
): TorrentStream[] {
  // resolução pela banda medida; tamanho pelo que um torrent costuma baixar
  const swarm = { ...ctx, mbps: Math.min(ctx.mbps, TORRENT_MAX_MBPS) };
  const key = (s: TorrentStream) => {
    const fits =
      s.resolution <= resolutionCap(ctx.mbps) &&
      fitsNetwork({ ...s, resolution: 0 }, swarm);
    return [
      compatTier(s, ctx),
      fits ? 1 : 0,
      languageTier(s, ctx),
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
  pt: "português",
  en: "inglês",
  es: "espanhol",
  fr: "francês",
  de: "alemão",
  it: "italiano",
  ja: "japonês",
  ko: "coreano",
  ru: "russo",
};

/** Resumo de uma linha da fonte em uso, para o espectador. */
export function describeStream(s: ParsedStream): string {
  const parts: string[] = [];
  if (s.resolution)
    parts.push(s.resolution >= 2160 ? "4K" : `${s.resolution}p`);
  const named = s.languages.map((l) => LANGUAGE_LABELS[l] ?? l).join(" e ");
  // "dual"/"multi": a fonte diz que há mais de um áudio; os idiomas, só se ela citar
  if (s.multiAudio) parts.push(named ? `dual: ${named}` : "mais de um áudio");
  else if (named) parts.push(named);
  else parts.push("áudio original");
  parts.push(s.addon);
  return parts.join(", ");
}

const AUDIO_NAMES: Record<string, string> = {
  pt: "Português",
  en: "Inglês",
  es: "Espanhol",
  fr: "Francês",
  it: "Italiano",
  de: "Alemão",
  ja: "Japonês",
  ko: "Coreano",
  zh: "Chinês",
  hi: "Hindi",
  ru: "Russo",
  tr: "Turco",
};

export const audioName = (code: string) =>
  AUDIO_NAMES[code] ?? code.toUpperCase();

/** Um áudio que dá para escolher no player: fontes com o mesmo áudio viram uma opção só. */
export interface AudioChoice {
  key: string;
  label: string;
  /** idioma principal, quando se sabe */
  lang?: string;
  /** só o áudio original da obra */
  original: boolean;
}

/** O áudio de uma fonte, como a Netflix mostra: "Português", "Inglês [original]", "Dual: …". */
/**
 * Nome curto de uma lista de idiomas: até dois por extenso; mais que isso
 * (pacotes com seis áudios), português ou o original na frente e "e mais N".
 */
function languagesLabel(
  languages: string[],
  originalLanguage?: string,
): string {
  if (languages.length <= 2) return languages.map(audioName).join(" e ");
  const lead =
    languages.indexOf("pt") >= 0
      ? "pt"
      : originalLanguage && languages.indexOf(originalLanguage) >= 0
        ? originalLanguage
        : languages[0];
  return `${audioName(lead)} e mais ${languages.length - 1} idiomas`;
}

export function audioChoice(
  s: { languages: string[]; multiAudio: boolean },
  originalLanguage?: string,
): AudioChoice {
  const sorted = s.languages.slice().sort().join("+");
  if (s.multiAudio) {
    const named = languagesLabel(s.languages, originalLanguage);
    return {
      key: `multi:${sorted}`,
      label: named ? `Dual: ${named}` : "Dual áudio",
      original: false,
    };
  }
  if (
    !s.languages.length ||
    (!!originalLanguage &&
      s.languages.length === 1 &&
      s.languages[0] === originalLanguage)
  ) {
    const lang = originalLanguage;
    return {
      key: "original",
      label: lang ? `${audioName(lang)} [original]` : "Original",
      lang,
      original: true,
    };
  }
  return {
    key: sorted,
    label: languagesLabel(s.languages, originalLanguage),
    lang: s.languages[0],
    original: false,
  };
}
