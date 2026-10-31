import type { AddonStream } from '../data/addonClient';
import { normalizeLanguage } from '../data/language';

// Cada addon descreve a fonte em texto livre (nome, título, descrição). Aqui
// esse texto vira dados para o ranking. É heurística: cobre os formatos comuns.

export type Codec = 'h264' | 'hevc' | 'av1' | '';
export type Container = 'mp4' | 'mkv' | 'webm' | 'hls' | '';
/**
 * Por que a fonte fica de fora: torrent, link externo, cabeçalhos próprios,
 * gravação de cinema (não é exibida de jeito nenhum), arquivo que nem é vídeo
 * ou arquivo de outro título.
 */
export type Unplayable = 'torrent' | 'external' | 'headers' | 'cam' | 'not-video' | 'other-title';

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

/**
 * Cabeçalhos que o <video> não manda. Pedir só um User-Agent de navegador
 * ("Mozilla/…") não conta: o do navegador e o da TV já começam assim.
 */
function needsHeaders(request: Record<string, string> | undefined): boolean {
  if (!request) return false;
  return Object.keys(request).some((name) => !(name.toLowerCase() === 'user-agent' && /^Mozilla\//.test(request[name])));
}

/** player embutido de site ("MegaEmbed", ".../embed/123") */
const EMBED = /embed/i;

/** arquivo que não é vídeo (aplicativo, compactado, só a faixa de áudio: "…Tamil.Audio.GTM.m4a.mkv") */
const NOT_VIDEO = /\.(apk|exe|msi|dmg|zip|rar|7z|iso)(\b|$)|\.(m4a|mka|mp3)(\.\w{3,4})?$/i;

/** Minúsculas, sem acento, só letras e números separados por um espaço. */
const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** onde o título acaba no nome do arquivo: ano, S01E01, resolução */
const TITLE_END = /(^|[ ._\-[(])((19|20)\d\d|s\d{1,2}[ ._]?e\d{1,3}|s\d{1,2}|\d{3,4}p)(?=[ ._\-\])]|$)/i;

/**
 * Título no começo do nome do arquivo ("The.Bad.Guys.Breaking.In.S01E01…" →
 * "the bad guys breaking in"). Vazio quando o nome não tem esse formato.
 */
export function fileTitle(filename: string): string {
  const name = filename.split('|')[0].replace(/\.[a-z0-9]{2,4}$/i, '');
  const m = name.match(TITLE_END);
  return m && m.index ? fold(name.slice(0, m.index)) : '';
}

/**
 * Arquivo de outro título: o PenguPlay às vezes manda, na fonte de A Viagem de
 * Chihiro, "Lilo.and.Stitch.2002…" e, em Breaking Bad, "The.Bad.Guys.Breaking.In…".
 * Conta como certo o nome que contém um dos nomes do título (ou está contido
 * nele) ou que o próprio addon cita no texto da fonte ("🍿 Spirited Away").
 */
function otherTitle(filename: string, text: string, names: string[]): boolean {
  const part = fileTitle(filename);
  if (!part) return false;
  const has = (a: string, b: string) => !!a && !!b && ` ${a} `.indexOf(` ${b} `) >= 0;
  if (has(fold(text), part)) return false;
  return !names.some((name) => {
    const n = fold(name || '');
    return has(part, n) || has(n, part);
  });
}

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
  /** "dual" de release brasileiro: português e o original */
  dualAudio: boolean;
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
  /**
   * Os idiomas vieram da linha estruturada (ff:) e são a lista completa do
   * arquivo: "dual"/"multi" não deixa idioma implícito (o original) de fora.
   */
  exactLanguages?: boolean;
  /** duração do arquivo em segundos, quando o addon informa (linha ff:) */
  durationSec?: number;
  /** nome do arquivo que o addon informa na linha ff: */
  file?: string;
}

/**
 * Linha estruturada que um addon pode mandar no texto da fonte (no PlavioHD,
 * pelo "Custom formatter" da descrição), para o app não adivinhar pelo nome:
 *
 *   ff:lang=en,hi;sub=en;res=1080p;q=BluRay;enc=HEVC;dur=2h:49m:0s;size=15020000000;grp=LUMiX;se=S01E01;file=Nome.do.arquivo.mkv;
 *
 * Cada campo é `chave=valor;` (o `;` fecha o campo, então o que vier depois
 * do último, como o " [FB]" que o PlavioHD cola no fim, é ignorado). Listas
 * separadas por vírgula; idiomas em ISO 639-1, maiúsculas ou minúsculas (nome
 * em inglês e código de três letras também valem; o resto é descartado). Campo vazio vem omitido, e
 * campo omitido é "não sei": aí vale a dedução pelo nome.
 */
export interface StructuredInfo {
  /** idiomas do áudio; presente só se o addon mandou `lang` */
  languages?: string[];
  subtitles?: string[];
  resolution?: number;
  quality?: string;
  encode?: string;
  durationSec?: number;
  sizeBytes?: number;
  group?: string;
  seasonEpisode?: string;
  file?: string;
}

const STRUCTURED = /(^|\s)ff:((?:[a-z]+=[^;\n]*;)+)/i;

/**
 * Lista de idiomas → ISO 639-1. Aceita também nome ("ENGLISH") e código de três
 * letras: o PlavioHD manda o grupo inteiro junto ("ENGLISH, JAPANESE, FRENCH")
 * e às vezes esquece um deles nos códigos soltos. "X (SUB)" é legenda, não áudio.
 */
function languageList(value: string): { audio: string[]; subs: string[] } {
  const audio: string[] = [];
  const subs: string[] = [];
  value.split(',').forEach((part) => {
    const sub = /\(\s*sub(s|titles?)?\s*\)/i.test(part);
    const code = normalizeLanguage(part.replace(/\(.*?\)/g, '').trim());
    const list = sub ? subs : audio;
    if (code && list.indexOf(code) < 0) list.push(code);
  });
  return { audio, subs };
}

/** "2h:49m:0s", "169m", "10140" (segundos) → segundos */
function durationOf(value: string): number {
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value));
  let total = 0;
  let found = false;
  value.replace(/(\d+)\s*([hms])/gi, (_m, n: string, unit: string) => {
    found = true;
    total += Number(n) * (unit.toLowerCase() === 'h' ? 3600 : unit.toLowerCase() === 'm' ? 60 : 1);
    return '';
  });
  return found ? total : 0;
}

function heightOf(value: string): number {
  if (/^(4k|uhd)$/i.test(value)) return 2160;
  const m = value.match(/^(\d{3,4})[pi]$/i);
  return m ? Number(m[1]) : 0;
}

/** A linha ff: do texto, se houver, e o texto sem ela. */
export function readStructured(text: string): { info: StructuredInfo; rest: string } | null {
  const m = text.match(STRUCTURED);
  if (!m) return null;
  const info: StructuredInfo = {};
  m[2].split(';').forEach((pair) => {
    const eq = pair.indexOf('=');
    if (eq <= 0) return;
    const key = pair.slice(0, eq).trim().toLowerCase();
    const value = pair.slice(eq + 1).trim();
    if (!value) return;
    if (key === 'lang' || key === 'sub') {
      const { audio, subs } = languageList(value);
      if (key === 'lang') info.languages = audio;
      const subtitles = (info.subtitles ?? []).concat(key === 'sub' ? audio.concat(subs) : subs);
      if (subtitles.length) info.subtitles = subtitles.filter((c, i) => subtitles.indexOf(c) === i);
    }
    else if (key === 'res') info.resolution = heightOf(value) || undefined;
    else if (key === 'q') info.quality = value;
    else if (key === 'enc') info.encode = value;
    else if (key === 'dur') info.durationSec = durationOf(value) || undefined;
    else if (key === 'size') info.sizeBytes = Math.round(Number(value)) || undefined;
    else if (key === 'grp') info.group = value;
    else if (key === 'se') info.seasonEpisode = value;
    else if (key === 'file') info.file = value;
  });
  const start = (m.index ?? 0) + m[1].length;
  const end = text.indexOf('\n', start);
  const rest = (text.slice(0, start) + (end < 0 ? '' : text.slice(end))).replace(/[ \t]+\n/g, '\n').trim();
  return { info, rest };
}

/** Texto da fonte sem a linha ff: (para mostrar ou casar legenda). */
export const withoutStructured = (text: string) => readStructured(text)?.rest ?? text;

/** qualidade de gravação de cinema, como o AIOStreams escreve (CAM, TS, TC, SCR) */
const CAM_QUALITY = /^(hd-?)?(cam|ts|tc|scr|telesync|telecine)(rip)?$/i;

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
  // releases russos: cirílico, dublagem/voz-over (MVO, AVO, DVO), grupos e trackers
  [/[А-Яа-яЁё]|\b(lostfilm|newstudio|jaskier|hdrezka|rezka|kerob|rutor|rutracker|kinozal)\b/i, 'ru'],
  [/\b(MVO|AVO|DVO)\b/, 'ru'],
  // releases indianos (PenguPlay: Arctic, 4KHDHub): "Org.Hindi…English", "HIN.ENG".
  // A sigla só em maiúsculas: "Tel Aviv" não é télugo.
  // "AnimeDubHindi.…Dual.Audio": sem fronteira antes
  [/hindi/i, 'hi'],
  [/\bHIN\b/, 'hi'],
  [/\btamil\b/i, 'ta'],
  [/\bTAM\b/, 'ta'],
  [/\btelugu\b/i, 'te'],
  [/\bTEL\b/, 'te'],
  [/\b(ukrainian|ukr)\b/i, 'uk'],
  [/\barabic\b/i, 'ar'],
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

/** `names`: nomes do título (traduzido e original); com eles, arquivo de outro título fica de fora */
export function parseStream(stream: AddonStream, addon: string, names?: string[]): ParsedStream {
  const hints = stream.behaviorHints ?? {};
  const filename = hints.filename ?? '';
  const raw = [stream.name, stream.title, stream.description].filter(Boolean).join('\n');
  const structured = readStructured(raw);
  const ff = structured?.info ?? {};
  // a dedução pelo nome não lê a linha ff:, só o nome do arquivo que ela traz
  const text = [structured ? structured.rest : raw, filename, ff.file ?? ''].filter(Boolean).join('\n');

  let unplayable: Unplayable | undefined;
  if (!stream.url) unplayable = stream.infoHash ? 'torrent' : 'external';
  // <video> não deixa mandar cabeçalhos próprios na requisição
  else if (needsHeaders(hints.proxyHeaders && hints.proxyHeaders.request)) unplayable = 'headers';
  // página de player embutido (não é o arquivo de vídeo)
  else if (!containerOf(stream.url, filename, '') && EMBED.test(`${stream.url}\n${text}`)) unplayable = 'external';
  else if (NOT_VIDEO.test(filename || ff.file || '')) unplayable = 'not-video';
  else if (isCam(text, filename) || CAM_QUALITY.test(ff.quality ?? '')) unplayable = 'cam';
  // com a linha ff:, o título no texto é o lido do próprio arquivo: não confirma nada
  else if (names && otherTitle(filename || ff.file || '', structured ? '' : raw, names))
    unplayable = 'other-title';

  // Idiomas: a lista da linha ff: é a resposta; sem ela (ou sem código que
  // valha, como "RUSSIAN (SUB)"), o que o texto cita.
  const exactLanguages = !!ff.languages && ff.languages.length > 0;
  const languages: string[] = exactLanguages && ff.languages ? ff.languages.slice() : [];
  const add = (code: string) => languages.indexOf(code) < 0 && languages.push(code);
  if (!exactLanguages) {
    Object.keys(FLAGS).forEach((flag) => text.indexOf(flag) >= 0 && add(FLAGS[flag]));
    LANGUAGE_WORDS.forEach(([pattern, code]) => pattern.test(text) && add(code));
  }

  // "Dual Áudio", "Multi", "Multi-Lang". "Multi-Sub" é sobre legendas, não áudio.
  const multiAudio = exactLanguages
    ? languages.length > 1
    : /\b(dual|multi)(?![- .]?subs?\b)([- .]?(audio|áudio|lang))?\b/i.test(text);

  let resolution = ff.resolution ?? 0;
  if (!resolution) {
    for (const [pattern, height] of RESOLUTIONS) {
      if (pattern.test(text)) {
        resolution = height;
        break;
      }
    }
  }

  return {
    addon,
    url: stream.url,
    unplayable,
    resolution,
    sizeBytes: sizeOf(text, hints.videoSize || ff.sizeBytes),
    languages,
    multiAudio,
    // lista exata: nada fica implícito
    dualAudio: !exactLanguages && multiAudio && /\bdual\b/i.test(text),
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
    ...(exactLanguages ? { exactLanguages } : {}),
    ...(ff.durationSec ? { durationSec: ff.durationSec } : {}),
    ...(ff.file ? { file: ff.file } : {}),
  };
}
