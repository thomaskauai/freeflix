import type { AddonStream } from '../data/addonClient';

// Cada addon descreve a fonte em texto livre (nome, título, descrição). Aqui
// esse texto vira dados para o ranking. É heurística: cobre os formatos comuns.

export type Codec = 'h264' | 'hevc' | 'av1' | '';
export type Container = 'mp4' | 'mkv' | 'webm' | 'hls' | '';
/**
 * Por que a fonte fica de fora: torrent, link externo, cabeçalhos próprios,
 * gravação de cinema (não é exibida de jeito nenhum) ou arquivo que nem é vídeo.
 */
export type Unplayable = 'torrent' | 'external' | 'headers' | 'cam' | 'not-video';

/**
 * Gravação de cinema (câmera na sala ou áudio puxado do som da sala). Nos nomes
 * de lançamento as etiquetas vêm em maiúsculas (HDCAM, CAMRip, .TS., HDTS, TC,
 * TELECINE, DVDSCR, SCREENER), e só assim contam: nome de filme como "Cam
 * Girl", "The Screener" ou o canal Telecine fica de fora do filtro. "TS" e
 * "TC" só como etiqueta solta (".TS.", " TS "), não como extensão ".ts".
 * TELESYNC vale de qualquer jeito: não é palavra de título.
 */
const CAM_TAGS = /\b(HD-?)?CAM(-?R[Ii][Pp])?\b|\bCamRip\b|\bTELECINE\b|\b(DVD-?)?SCR(EENER)?\b|(^|[ ._\-[(])(HD-?)?(TS|TC)(?=[ ._\-\])])/;
const TELESYNC = /\btele-?sync\b/i;
/**
 * No nome do arquivo, depois do ano, já não é título: ali a etiqueta conta em
 * qualquer caixa ("Clayface.2026.Tc.1080p.mkv").
 */
const CAM_AFTER_YEAR = /(^|[ ._\-[(])(HD-?)?(TS|TC|CAM(-?RIP)?)(?=[ ._\-\])])/i;
const afterYear = (filename: string) => {
  const m = filename.match(/(^|[ ._(\-])(19|20)\d\d(?=[ ._)\-])/);
  return m ? filename.slice((m.index ?? 0) + m[0].length) : '';
};
/** "PreDVD"/"HQ Pre": lançamento de antes do filme sair em vídeo, gravado no cinema */
const PRE_RELEASE = /\bpre-?dvd(-?rip)?\b|\bhq[ ._-]?pre\b/i;
const isCam = (text: string, filename: string) =>
  CAM_TAGS.test(text) || TELESYNC.test(text) || PRE_RELEASE.test(text) || CAM_AFTER_YEAR.test(afterYear(filename));

/** arquivo que não é vídeo (aplicativo, compactado) */
const NOT_VIDEO = /\.(apk|exe|msi|dmg|zip|rar|7z|iso)(\b|$)/i;

export interface ParsedStream {
  addon: string;
  /** posição da fonte na ordem de preferência (lista padrão); menor vem antes */
  priority?: number;
  /** endereço base do addon que trouxe a fonte */
  base?: string;
  url?: string;
  /** por que este app não consegue tocar a fonte; ausente se toca */
  unplayable?: Unplayable;
  /** altura em pixels; 0 se o texto não diz */
  resolution: number;
  /** 0 se desconhecido */
  sizeBytes: number;
  /** códigos de idioma citados no texto (pt, en, es…) */
  languages: string[];
  /** "dual", "multi": traz mais de um áudio, em geral o original e uma dublagem */
  multiAudio: boolean;
  codec: Codec;
  hdr: boolean;
  container: Container;
  /** o addon avisou que pode não tocar direto num navegador */
  notWebReady: boolean;
  /**
   * Legenda gravada na imagem ("Legendado", "hardsub"): o vídeo já mostra a
   * legenda, e a do app ficaria por cima dela.
   */
  hardSubs?: boolean;
}

const RESOLUTIONS: [RegExp, number][] = [
  [/\b(2160p|4k|uhd)\b/i, 2160],
  [/\b1440p\b/i, 1440],
  [/\b(1080p|1080i|fhd|full\s*hd)\b/i, 1080],
  [/\b720p\b/i, 720],
  [/\b(480p|576p)\b/i, 480],
  [/\b360p\b/i, 360],
];

const FLAGS: Record<string, string> = {
  '🇧🇷': 'pt',
  '🇵🇹': 'pt',
  '🇺🇸': 'en',
  '🇬🇧': 'en',
  '🇪🇸': 'es',
  '🇲🇽': 'es',
  '🇫🇷': 'fr',
  '🇩🇪': 'de',
  '🇮🇹': 'it',
  '🇯🇵': 'ja',
  '🇰🇷': 'ko',
  '🇷🇺': 'ru',
};

const LANGUAGE_WORDS: [RegExp, string][] = [
  [/\b(dublado|dub[- .]?pt|pt[- .]?br|portugu[eê]s|portuguese|nacional)\b/i, 'pt'],
  [/\b(english|eng)\b/i, 'en'],
  [/\b(latino|espa[nñ]ol|castellano|spanish|lat)\b/i, 'es'],
  [/\b(french|fran[cç]ais|truefrench|vff|vfq)\b/i, 'fr'],
  [/\b(german|deutsch)\b/i, 'de'],
  [/\b(italian|italiano|ita)\b/i, 'it'],
  [/\b(japanese|jap)\b/i, 'ja'],
  [/\b(korean|kor)\b/i, 'ko'],
  [/\b(russian|rus)\b/i, 'ru'],
];

const UNITS: Record<string, number> = { kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3 };

function sizeOf(text: string, hinted?: number): number {
  if (hinted && hinted > 0) return hinted;
  const m = text.match(/(?:💾\s*)?(\d+(?:[.,]\d+)?)\s*(kib|mib|gib|kb|mb|gb|tb)\b/i);
  if (!m) return 0;
  return Number(m[1].replace(',', '.')) * UNITS[m[2].toLowerCase()];
}

function containerOf(url: string | undefined, filename: string, text: string): Container {
  const path = `${url ? url.split('?')[0] : ''} ${filename}`.toLowerCase();
  if (/\.m3u8\b/.test(path)) return 'hls';
  if (/\.mkv\b/.test(path)) return 'mkv';
  if (/\.(mp4|m4v)\b/.test(path)) return 'mp4';
  if (/\.webm\b/.test(path)) return 'webm';
  if (/\bmkv\b/i.test(text)) return 'mkv';
  if (/\bmp4\b/i.test(text)) return 'mp4';
  return '';
}

export function parseStream(stream: AddonStream, addon: string): ParsedStream {
  const hints = stream.behaviorHints ?? {};
  const filename = hints.filename ?? '';
  const text = [stream.name, stream.title, stream.description, filename].filter(Boolean).join('\n');

  let unplayable: Unplayable | undefined;
  if (!stream.url) unplayable = stream.infoHash ? 'torrent' : 'external';
  // <video> não deixa mandar cabeçalhos próprios na requisição
  else if (hints.proxyHeaders && hints.proxyHeaders.request && Object.keys(hints.proxyHeaders.request).length > 0) {
    unplayable = 'headers';
  } else if (NOT_VIDEO.test(filename)) unplayable = 'not-video';
  else if (isCam(text, filename)) unplayable = 'cam';

  const languages: string[] = [];
  const add = (code: string) => languages.indexOf(code) < 0 && languages.push(code);
  Object.keys(FLAGS).forEach((flag) => text.indexOf(flag) >= 0 && add(FLAGS[flag]));
  LANGUAGE_WORDS.forEach(([pattern, code]) => pattern.test(text) && add(code));

  let resolution = 0;
  for (const [pattern, height] of RESOLUTIONS) {
    if (pattern.test(text)) {
      resolution = height;
      break;
    }
  }

  return {
    addon,
    url: stream.url,
    unplayable,
    resolution,
    sizeBytes: sizeOf(text, hints.videoSize),
    languages,
    // "Dual Áudio", "Multi", "Multi-Lang". "Multi-Sub" é sobre legendas, não áudio.
    multiAudio: /\b(dual|multi)(?![- .]?subs?\b)([- .]?(audio|áudio|lang))?\b/i.test(text),
    codec: /\b(hevc|[hx][. ]?265)\b/i.test(text)
      ? 'hevc'
      : /\bav1\b/i.test(text)
        ? 'av1'
        : /\b(avc|[hx][. ]?264)\b/i.test(text)
          ? 'h264'
          : '',
    hdr: /\b(hdr10\+?|hdr|dolby\s*vision|dovi|dv)\b/i.test(text),
    container: containerOf(stream.url, filename, text),
    notWebReady: !!hints.notWebReady,
    hardSubs: /\blegendad[oa]s?\b|\bhard[- ]?sub(s|bed)?\b|\blegendas?\s+embutidas?\b/i.test(text),
  };
}
