import { getJson, type AddonStream } from '../data/addonClient';

// Legendas do OpenSubtitles, por dois caminhos:
//  - o addon v3 do Stremio (/subtitles/{tipo}/{id}.json): rápido, mas a lista
//    vem cortada em 100 legendas de todos os idiomas, as mais antigas. Num
//    filme de 2014 só sobram as de cinema (CAM, TS, screener), com o tempo de
//    outra gravação: em Interstellar a primeira "pob" era de um HDTS, 22 a 27 s
//    adiantada no vídeo de BluRay/WEB que as fontes HTTP tocam.
//  - a busca REST do OpenSubtitles (rest.opensubtitles.org), por idioma, que
//    traz as de BluRay/WEB. É a API antiga; se cair, fica só o addon.
// Das duas sai uma lista por idioma, ordenada pelo quanto a legenda parece ser
// da mesma versão do vídeo (nome do release); ao carregar, a duração confere.

const SUBTITLES_BASE = 'https://opensubtitles-v3.strem.io';
const REST_BASE = 'https://rest.opensubtitles.org/search';
/** baixa o .srt já em UTF-8, com CORS; aceita qualquer arquivo do OpenSubtitles */
const DOWNLOAD_BASE = 'https://subs5.strem.io/en/download/subencoding-stremio-utf8/src-api/file/';
const REST_TIMEOUT_MS = 8000;
const KEY = 'freeflix.subtitles';
/** legendas tentadas ao carregar, até uma ter a duração do vídeo */
const LOAD_TRIES = 3;

export type SubtitleLanguage = 'pt' | 'en' | 'es';

/** Idiomas oferecidos, com os códigos que o addon usa; o primeiro código é o preferido. */
export const SUBTITLE_LANGUAGES: { id: SubtitleLanguage; label: string; codes: string[] }[] = [
  { id: 'pt', label: 'Português (Brasil)', codes: ['pob', 'por'] },
  { id: 'en', label: 'English', codes: ['eng'] },
  { id: 'es', label: 'Español', codes: ['spa'] },
];

/** Uma legenda achada para o título. */
export interface SubtitleCandidate {
  url: string;
  /** código do OpenSubtitles (pob, por, eng…) */
  lang: string;
  /** nome do release para o qual foi feita, com o formato (BluRay, CAM…) quando dito */
  release: string;
  /** quantas vezes foi baixada (só a busca REST diz) */
  downloads: number;
}

export interface SubtitleOption {
  language: SubtitleLanguage;
  label: string;
  /** endereço da melhor */
  url: string;
  /** todas do idioma, da que mais parece ser deste vídeo para a que menos */
  candidates: SubtitleCandidate[];
}

interface AddonSubtitle {
  url?: string;
  lang?: string;
  movieReleaseName?: string;
  subtitleFileName?: string;
  releaseFormat?: string;
  releaseOther?: string;
}

interface RestSubtitle {
  IDSubtitleFile?: string;
  SubLanguageID?: string;
  MovieReleaseName?: string;
  SubFileName?: string;
  InfoFormat?: string;
  SubDownloadsCnt?: string;
  SubBad?: string;
  SubSumCD?: string;
}

// ---------------------------------------------------------------------------
// Nome do release do vídeo

const releases = new WeakMap<object, string>();

/**
 * Nome do arquivo de uma fonte, para casar com o da legenda: o filename que o
 * addon manda, ou o fim do endereço quando é um nome de arquivo de verdade.
 * Sem isso, o texto da fonte (às vezes diz BluRay, WEB-DL…).
 */
export function streamRelease(stream: AddonStream): string {
  const hinted = stream.behaviorHints && stream.behaviorHints.filename;
  // o PenguPlay cola "|^|" e outras marcas depois do nome
  if (hinted) return hinted.split('|')[0].trim();
  const path = (stream.url || '').split('?')[0].split('#')[0];
  let last = path.slice(path.lastIndexOf('/') + 1);
  try {
    last = decodeURIComponent(last);
  } catch {
    /* fica como veio */
  }
  if (/\.(mkv|mp4|avi|m4v|webm)$/i.test(last) && /(^|[^0-9])((19|20)\d\d|\d{3,4}p)([^0-9]|$)/i.test(last)) return last;
  return [stream.title || stream.description || '', stream.name || ''].join(' ').replace(/\s+/g, ' ').trim();
}

/** Guarda o nome do release junto da fonte já lida (sem mexer no tipo dela). */
export function rememberRelease(parsed: object, stream: AddonStream) {
  releases.set(parsed, streamRelease(stream));
}

export const releaseOf = (parsed: object): string | undefined => releases.get(parsed);

// ---------------------------------------------------------------------------
// Casar legenda e vídeo

export type ReleaseKind = 'retail' | 'screener' | 'cam' | 'unknown';

const words = (name: string) =>
  ` ${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

const CAM = / (hd ?)?cam(rip)? | (hd ?)?ts | hdts | telesync | (hd ?)?tc | telecine | hc | r[56] | p(re)?dvd(rip)? /;
const SCREENER = / (dvd|bd|web)? ?scr(eener)? | dvdscr /;
const BLURAY = / blu ?ray | bd ?rip | br ?rip | bd ?remux | remux | bdmv | uhd /;
const WEB = / web ?(dl|rip)? | amzn | nf | dsnp | hmax | atvp | itunes /;
const RETAIL = / hdtv | dvd ?rip | hd ?rip | dvd /;

/** De que gravação é o release: loja/disco, screener ou cinema. */
export function releaseKind(name: string): ReleaseKind {
  const w = words(name);
  if (CAM.test(w)) return 'cam';
  if (SCREENER.test(w)) return 'screener';
  if (BLURAY.test(w) || WEB.test(w) || RETAIL.test(w)) return 'retail';
  return 'unknown';
}

const family = (name: string) => {
  const w = words(name);
  return BLURAY.test(w) ? 'bluray' : WEB.test(w) ? 'web' : '';
};

/** Cortes com outra duração: legenda de um não serve no outro. */
const EDITIONS = [/ extended /, / unrated /, / directors? (cut )?| dc /, / uncut /, / theatrical /];

/** Grupos citados no nome ("…x264-SPARKS.mkv" → sparks), em minúsculas. */
function releaseGroups(name: string): string[] {
  const groups: string[] = [];
  const re = /-\s?([a-z0-9]{2,15})(?=\)?(?:\.[a-z0-9]{2,4})?(?:[\s\]]|$))/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(name))) groups.push(m[1].toLowerCase());
  return groups;
}

/** palavras que todo release tem ou que não dizem a versão */
const NOISE = /^((19|20)\d\d|\d{3,4}p|[xh]26[45]|hevc|avc|aac|ac3|dts|ddp?\d*|\d+|mkv|mp4|avi|srt|the|a|of)$/;
const CODECS = ['h264', 'x264', 'h265', 'x265', 'hevc', 'aac', 'ac3', 'dts', 'ddp'];

const tokens = (name: string) => words(name).trim().split(' ').filter((t) => t && !NOISE.test(t));

/**
 * Quanto a legenda parece ser do mesmo vídeo; maior, melhor. O formato manda
 * (BluRay/WEB antes de screener, e gravação de cinema por último, a não ser que
 * o vídeo também seja); depois o grupo e as outras palavras do nome em comum;
 * por fim, as mais baixadas.
 */
export function scoreSubtitle(sub: SubtitleCandidate, videoRelease = ''): number {
  const subKind = releaseKind(sub.release);
  const videoKind = releaseKind(videoRelease);
  let score: number;
  if (videoKind === 'cam') score = subKind === 'cam' ? 30 : subKind === 'unknown' ? 20 : 10;
  else score = { retail: 30, unknown: 20, screener: 10, cam: 0 }[subKind];

  const vf = family(videoRelease);
  if (vf && vf === family(sub.release)) score += 4;

  const groups = releaseGroups(videoRelease);
  const group = groups[groups.length - 1];
  if (group && releaseGroups(sub.release).indexOf(group) >= 0) score += 6;

  const vw = words(videoRelease);
  const sw = words(sub.release);
  EDITIONS.forEach((edition) => {
    if (edition.test(vw) !== edition.test(sw)) score -= 8;
  });
  // "forced": só as falas em outra língua (placas, alienígena); não serve de legenda
  if (/ forced /.test(sw)) score -= 40;
  // palavras em comum desempatam, sem pesar mais que o grupo; codec e áudio
  // iguais também contam (RARBG H264.AAC ≠ RARBG x264.DTS, com tempos diferentes)
  const theirs = tokens(videoRelease);
  let shared = 0;
  tokens(sub.release).forEach((w, i, mine) => {
    if (mine.indexOf(w) === i && theirs.indexOf(w) >= 0) shared++;
  });
  CODECS.forEach((t) => {
    if (sw.indexOf(` ${t} `) >= 0 && vw.indexOf(` ${t} `) >= 0) shared++;
  });
  score += Math.min(5, shared);

  return score + Math.min(3, Math.log(sub.downloads + 1) / Math.LN10 / 2);
}

/** As legendas da melhor para a pior para este vídeo; empate fica na ordem de chegada. */
export function rankSubtitles(subs: SubtitleCandidate[], videoRelease?: string): SubtitleCandidate[] {
  return subs
    .map((s, i) => ({ s, i, k: scoreSubtitle(s, videoRelease) }))
    .sort((a, b) => b.k - a.k || a.i - b.i)
    .map((e) => e.s);
}

// ---------------------------------------------------------------------------
// Busca

const fileId = (url: string) => {
  const m = /\/file\/(\d+)/.exec(url);
  return m ? m[1] : url;
};

function fromAddon(type: string, videoId: string): Promise<SubtitleCandidate[]> {
  return getJson<{ subtitles?: AddonSubtitle[] }>(
    `${SUBTITLES_BASE}/subtitles/${type}/${encodeURIComponent(videoId)}.json`,
  ).then((data) =>
    (data.subtitles || [])
      .filter((s) => s.url && s.lang)
      .map((s) => ({
        url: s.url as string,
        lang: s.lang as string,
        release: [s.movieReleaseName, s.subtitleFileName, s.releaseFormat, s.releaseOther].filter(Boolean).join(' '),
        downloads: 0,
      })),
  );
}

/** Busca REST de um idioma; série vai com temporada e episódio (nessa ordem de chaves, a da API). */
function fromRest(videoId: string, code: string): Promise<SubtitleCandidate[]> {
  const parts = videoId.split(':');
  const imdb = parts[0].replace(/^tt/, '');
  const path =
    parts.length === 3
      ? `episode-${parts[2]}/imdbid-${imdb}/season-${parts[1]}`
      : `imdbid-${imdb}`;
  return getJson<RestSubtitle[]>(`${REST_BASE}/${path}/sublanguageid-${code}`, REST_TIMEOUT_MS).then((list) =>
    (Array.isArray(list) ? list : [])
      // marcada como ruim, ou em mais de um arquivo (CD1/CD2): fora
      .filter((s) => s.IDSubtitleFile && s.SubBad !== '1' && (!s.SubSumCD || s.SubSumCD === '1'))
      .map((s) => ({
        url: DOWNLOAD_BASE + s.IDSubtitleFile,
        lang: s.SubLanguageID || code,
        release: [s.MovieReleaseName, s.SubFileName, s.InfoFormat].filter(Boolean).join(' ').trim(),
        downloads: Number(s.SubDownloadsCnt) || 0,
      })),
  );
}

const found = new Map<string, Promise<SubtitleCandidate[]>>();

/** Todas as legendas dos idiomas oferecidos, das duas buscas, sem repetir arquivo. */
function allSubtitles(type: string, videoId: string): Promise<SubtitleCandidate[]> {
  const key = `${type}/${videoId}`;
  const hit = found.get(key);
  if (hit) return hit;
  const codes = ([] as string[]).concat(...SUBTITLE_LANGUAGES.map((l) => l.codes));
  const none = () => [] as SubtitleCandidate[];
  const rest = Promise.all(codes.map((code) => fromRest(videoId, code).catch(none)));
  const addon = fromAddon(type, videoId);
  const request = Promise.all([addon.catch(none), rest]).then(([fromV3, lists]) => {
    const all = ([] as SubtitleCandidate[]).concat(...lists, fromV3);
    if (!all.length) {
      // nada das duas: a falha do addon aparece (o player mostra "sem legendas")
      return addon.then(none);
    }
    const seen: Record<string, boolean> = {};
    return all.filter((s) => {
      const id = fileId(s.url);
      if (seen[id]) return false;
      seen[id] = true;
      return true;
    });
  });
  found.set(key, request);
  request.catch(() => found.delete(key));
  return request;
}

/**
 * Uma opção por idioma oferecido, para o título ou episódio. `videoId` é o id
 * IMDb (tt…), com :temporada:episódio em séries; `videoRelease`, o nome do
 * arquivo que vai tocar (streamRelease), para escolher a legenda da mesma versão.
 */
export async function findSubtitles(type: string, videoId: string, videoRelease?: string): Promise<SubtitleOption[]> {
  const all = await allSubtitles(type, videoId);
  const options: SubtitleOption[] = [];
  SUBTITLE_LANGUAGES.forEach((language) => {
    // a ordem dos códigos manda: pt-BR antes de pt-PT
    const candidates = ([] as SubtitleCandidate[]).concat(
      ...language.codes.map((code) => rankSubtitles(all.filter((s) => s.lang === code), videoRelease)),
    );
    if (candidates.length) {
      options.push({ language: language.id, label: language.label, url: candidates[0].url, candidates });
    }
  });
  return options;
}

// ---------------------------------------------------------------------------
// Tempo

/** .srt → WebVTT, o único formato que <track> aceita. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    // 00:01:02,345 → 00:01:02.345
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return `WEBVTT\n\n${body.trim()}\n`;
}

const STAMP = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/g;
const CUE_LINE = /^.*-->.*$/gm;

const seconds = (h: string, m: string, s: string, ms: string) =>
  Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(`0.${ms}`);

function stamp(t: number): string {
  const total = Math.max(0, Math.round(t * 1000));
  const two = (n: number) => (n < 10 ? `0${n}` : String(n));
  const ms = total % 1000;
  const s = Math.floor(total / 1000);
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}.${
    ms < 10 ? `00${ms}` : ms < 100 ? `0${ms}` : ms
  }`;
}

/**
 * Fim da última fala, sem contar as 2 últimas (o OpenSubtitles e os
 * legendadores põem créditos e propaganda no fim, às vezes depois do filme).
 */
export function lastSpeech(text: string): number {
  const ends: number[] = [];
  (text.match(CUE_LINE) || []).forEach((line) => {
    const parts = line.split('-->');
    STAMP.lastIndex = 0;
    const m = STAMP.exec(parts[1] || '');
    if (m) ends.push(seconds(m[1], m[2], m[3], m[4]));
  });
  if (!ends.length) return 0;
  ends.sort((a, b) => a - b);
  return ends[Math.max(0, ends.length - 3)];
}

/** quadros por segundo de cinema (23,976) sobre o PAL (25): a legenda de um corre 4% no outro */
export const FILM_ON_PAL = 24000 / 1001 / 25;

/**
 * A legenda cabe no vídeo? Devolve a escala dos tempos (1 = como está) ou null
 * quando não é deste vídeo. Curta demais (menos da metade) é de outra coisa
 * (documentário, CD1), e rala demais é "forced"; passando do fim de 1,5 a 5% é a de cinema sobre um vídeo
 * PAL, que se corrige encolhendo os tempos. Créditos longos não enganam: a
 * legenda que termina cedo é aceita como está.
 */
export function timingScale(lastEnd: number, duration: number, cues = Infinity): number | null {
  if (!(duration > 0) || !isFinite(duration) || !(lastEnd > 0)) return 1;
  // menos de uma fala a cada 2 min: legenda "forced" (só placas e outra língua)
  if (lastEnd < duration * 0.5 || cues < duration / 120) return null;
  const over = lastEnd / duration;
  if (over <= 1.015) return 1;
  if (over <= 1.05 && lastEnd * FILM_ON_PAL <= duration) return FILM_ON_PAL;
  return null;
}

/** WebVTT com os tempos escalados e deslocados (segundos; + atrasa a legenda). */
export function shiftVtt(vtt: string, offset: number, scale = 1): string {
  if (!offset && scale === 1) return vtt;
  return vtt.replace(CUE_LINE, (line) =>
    line.replace(STAMP, (_, h, m, s, ms) => stamp(seconds(h, m, s, ms) * scale + offset)),
  );
}

const texts = new Map<string, Promise<string>>();

function download(url: string): Promise<string> {
  const hit = texts.get(url);
  if (hit) return hit;
  const request = fetch(url).then((res) => {
    if (!res.ok) throw new Error(`http ${res.status}`);
    return res.text().then(srtToVtt);
  });
  texts.set(url, request);
  request.catch(() => texts.delete(url));
  return request;
}

export interface LoadedSubtitle {
  /** posição em option.candidates */
  index: number;
  vtt: string;
  scale: number;
}

/**
 * Baixa a melhor legenda do idioma a partir de `from` que cabe no vídeo
 * (`duration` é lida depois do download: o vídeo pode ainda estar abrindo).
 * Nenhuma cabendo, fica a primeira que baixou.
 */
export async function loadSubtitle(
  option: SubtitleOption,
  duration: () => number,
  from = 0,
): Promise<LoadedSubtitle> {
  const list = option.candidates.length ? option.candidates : [{ url: option.url } as SubtitleCandidate];
  let fallback: LoadedSubtitle | null = null;
  let error: unknown = null;
  for (let n = 0; n < LOAD_TRIES && n < list.length; n++) {
    const index = (from + n) % list.length;
    let vtt: string;
    try {
      vtt = await download(list[index].url);
    } catch (e) {
      error = e;
      continue;
    }
    const scale = timingScale(lastSpeech(vtt), duration(), (vtt.match(CUE_LINE) || []).length);
    if (scale !== null) return { index, vtt, scale };
    if (!fallback) fallback = { index, vtt, scale: 1 };
  }
  if (fallback) return fallback;
  throw error || new Error('sem legenda');
}

/** Endereço local que <track> consegue ler, com o ajuste de tempo aplicado. */
export function subtitleSrc(loaded: LoadedSubtitle, offset: number): string {
  return URL.createObjectURL(new Blob([shiftVtt(loaded.vtt, offset, loaded.scale)], { type: 'text/vtt' }));
}

/** Idioma de legenda usado da última vez; vale para o próximo vídeo. */
export function rememberedSubtitle(): SubtitleLanguage | null {
  try {
    const saved = window.localStorage.getItem(KEY);
    return SUBTITLE_LANGUAGES.some((l) => l.id === saved) ? (saved as SubtitleLanguage) : null;
  } catch {
    return null;
  }
}

export function rememberSubtitle(language: SubtitleLanguage | null) {
  try {
    if (language) window.localStorage.setItem(KEY, language);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* sem persistência nesta sessão */
  }
}
