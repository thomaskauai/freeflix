import {
  episodeProgressOf,
  getEpisodeProgress,
  getProgress,
  isFinished,
  preferredSource,
  rememberSource,
} from '../data/storage';
import type { Title } from '../data/types';
import { loadHls } from './loadHls';
import { offersAudio, type SourceProfile } from './rank';
import { resolvePlayback, type Candidate, type NoSourceReason, type Resolution } from './resolve';
import {
  dropTorrent,
  holdTorrent,
  noStreamingInBrazil,
  sweepTorrents,
  torrentAvailable,
  torrentCandidate,
  torrentInPreferredAudio,
} from './torrent';
import { audioFor } from './audioMemory';

/** fontes encontradas valem por este tempo; links de streaming costumam expirar */
const PLAN_TTL_MS = 10 * 60 * 1000;
/** vídeo pré-carregado que ninguém usou depois que a página de detalhes saiu */
const RELEASE_AFTER_MS = 4000;
/** fontes que o pré-carregamento tenta antes de desistir */
const PRELOAD_TRIES = 4;
/**
 * Saindo do player, o vídeo fica guardado, pausado, por este tempo: Voltar
 * apertado sem querer e o play de novo continuam na hora, sem recarregar.
 */
const PARK_MS = 90 * 1000;

/** links que já falharam nesta sessão: o player começa pelo próximo */
const failedUrls: Record<string, boolean> = {};

/** O player avisa que uma fonte não tocou. */
export function markFailed(url: string) {
  failedUrls[url] = true;
}

export const hasFailed = (url: string) => !!failedUrls[url];

/**
 * Por onde o player começa: a fonte do vídeo que ficou guardado ao sair deste
 * mesmo episódio, senão a primeira que ainda não falhou.
 */
export function firstWorking(plan: Plan, title: Title, season?: number, episode?: number): Plan {
  if (plan.status !== 'play') return plan;
  const key = keyOf(title, season, episode);
  const urls = plan.candidates.map((c) => c.url);
  // guardado com outro idioma preferido não serve: o espectador trocou o áudio
  const kept =
    preloaded && preloaded.key === key && preloaded.audio === audioFor(title) ? urls.indexOf(preloaded.url) : -1;
  const index = kept >= 0 ? kept : plan.candidates.map((c) => !failedUrls[c.url]).indexOf(true);
  return index > 0 ? { ...plan, index } : plan;
}

export type Plan =
  | { status: 'embed'; url: string }
  | {
      status: 'play';
      candidates: Candidate[];
      index: number;
      /**
       * Episódio com fonte escolhida antes: o plano sai só com o que aquele
       * addon tem, sem esperar os outros. As demais fontes chegam aqui depois,
       * como reserva.
       */
      more?: Promise<Candidate[]>;
    }
  | { status: 'none'; reason: NoSourceReason | 'all-failed' };

/** Junta as fontes que chegaram depois, sem repetir, mantendo a ordem do que já está na tela. */
export function mergeCandidates(current: Candidate[], more: Candidate[]): Candidate[] {
  const seen: Record<string, boolean> = {};
  current.forEach((c) => (seen[c.url] = true));
  return current.concat(more.filter((c) => !seen[c.url]));
}

/**
 * URL do embed: {base}/embed/{tmdbId} ou {base}/embed/{tmdbId}/{temporada}/{episódio}.
 * A base vem de VITE_EMBED_BASE_URL; sem ela não há embed.
 */
export function embedUrlFor(tmdbId: number | null | undefined, season?: number, episode?: number): string | null {
  const base = ((import.meta.env.VITE_EMBED_BASE_URL as string | undefined) ?? '').replace(/\/$/, '');
  if (!base || tmdbId == null) return null;
  const path = season != null && episode != null ? `/embed/${tmdbId}/${season}/${episode}` : `/embed/${tmdbId}`;
  return `${base}${path}`;
}

/**
 * De onde o vídeo começa e quanto dura, pelo progresso salvo: o do episódio,
 * em séries; o do título, em filmes. Visto até o fim recomeça do início.
 */
export function resumePoint(title: Title, season?: number, episode?: number) {
  const saved =
    season != null && episode != null
      ? episodeProgressOf(getEpisodeProgress(title.id), season, episode)
      : getProgress(title.id);
  return {
    startAt: saved && !isFinished(saved) ? saved.time : 0,
    duration: saved && saved.duration ? saved.duration : (title.runtime ?? 0) * 60,
  };
}

const keyOf = (title: Title, season?: number, episode?: number) => `${title.type}/${title.id}/${season}/${episode}`;

/** o plano depende do idioma preferido: com outro, a busca é outra */
const plans: Record<string, { at: number; plan: Promise<Plan> }> = {};

/**
 * De onde sai o vídeo: embed configurado ou as fontes instaladas. A busca nas
 * fontes fica guardada por alguns minutos, então a página de detalhes pode
 * começá-la antes do play e o player só colhe o resultado.
 */
export function planFor(title: Title, season?: number, episode?: number): Promise<Plan> {
  const embed = embedUrlFor(title.tmdbId, season, episode);
  if (embed) return Promise.resolve({ status: 'embed', url: embed });

  const key = `${keyOf(title, season, episode)}/${audioFor(title)}`;
  const cached = plans[key];
  if (cached && Date.now() - cached.at < PLAN_TTL_MS) return cached.plan;

  const toPlan = (found: Resolution): Plan =>
    'reason' in found
      ? { status: 'none', reason: found.reason }
      : { status: 'play', candidates: found.candidates, index: 0, more: found.later };
  // a lista inteira, com os addons lentos, quando chegarem
  const everything = (p: Plan): Promise<Candidate[]> =>
    p.status !== 'play' ? Promise.resolve([]) : p.more ? p.more : Promise.resolve(p.candidates);
  const unreachable = (): Plan => ({ status: 'none', reason: 'unreachable' });

  // Episódio de série que já tocou outro: pergunta primeiro só ao addon que
  // funcionou, pela mesma opção (resolução e áudio). Os outros addons respondem
  // em paralelo e entram como reserva, sem atrasar o play.
  // Fonte de outro áudio (o espectador trocou a preferência depois) não vale mais.
  const remembered = season != null ? preferredSource(title.id) : undefined;
  const prefer: SourceProfile | undefined =
    remembered && offersAudio(remembered, { audio: audioFor(title), originalLanguage: title.originalLanguage })
      ? remembered
      : undefined;
  const full = resolvePlayback(title, season, episode, { prefer }).then(toPlan, unreachable);
  const httpPlan = prefer
    ? resolvePlayback(title, season, episode, { prefer, only: prefer.base })
        .then(toPlan, unreachable)
        .then(
          (quick): Plan | Promise<Plan> =>
            quick.status === 'play'
              ? { ...quick, more: full.then(everything) }
              : full,
        )
    : full;
  // Sem streaming no Brasil (lançamento recente, título fora dos catálogos), as
  // fontes HTTP costumam ser fracas: com o motor no ar, o torrent vem primeiro e
  // as fontes HTTP ficam de reserva. Episódio com fonte escolhida antes segue ela.
  let torrentTried = false;
  const torrentFirst = prefer
    ? Promise.resolve(null)
    : torrentAvailable()
        .then((ok) => ok && noStreamingInBrazil(title))
        // só no áudio preferido: sem ele, as fontes HTTP vêm primeiro
        .then((yes) =>
          yes ? ((torrentTried = true), torrentCandidate(title, season, episode, torrentInPreferredAudio(title))) : null,
        )
        .catch(() => null);
  // Nenhuma fonte HTTP: o torrent é a reserva antes de dizer que não há o título.
  // Já tentado no áudio preferido (torrentFirst), sobram os de outro áudio.
  const torrentBackup = (none: Plan): Promise<Plan> =>
    torrentAvailable()
      .then((ok) => {
        if (!ok) return null;
        const preferred = torrentInPreferredAudio(title);
        return torrentCandidate(title, season, episode, torrentTried ? (t) => !preferred(t) : undefined);
      })
      .then((torrent): Plan => (torrent ? { status: 'play', candidates: [torrent], index: 0 } : none))
      .catch(() => none);
  const plan = torrentFirst.then(
    (torrent): Plan | Promise<Plan> =>
      torrent
        ? {
            status: 'play',
            candidates: [torrent],
            index: 0,
            more: httpPlan.then(everything),
          }
        : httpPlan.then((p) => (p.status === 'none' ? torrentBackup(p) : p)),
  );
  plans[key] = { at: Date.now(), plan };
  // sem fonte, a próxima tentativa pergunta de novo
  plan.then((p) => p.status === 'none' && plans[key] && plans[key].plan === plan && delete plans[key]);
  return plan;
}

/**
 * Liga a fonte ao <video>: direto onde o aparelho toca HLS (TV) ou o arquivo
 * não é HLS; senão por hls.js. Devolve como desligar.
 */
export function attachSource(video: HTMLVideoElement, url: string, hls: boolean): () => void {
  // torrent segue aberto no motor enquanto houver vídeo ligado a ele
  holdTorrent(url);
  let held = true;
  const unhold = () => {
    if (held) dropTorrent(url);
    held = false;
  };
  if (!hls || video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = url;
    return unhold;
  }
  let alive = true;
  let destroy: (() => void) | undefined;
  loadHls().then(
    (Hls) => {
      if (!alive) return;
      if (!Hls.isSupported()) {
        video.src = url;
        return;
      }
      const player = new Hls();
      player.loadSource(url);
      player.attachMedia(video);
      // erro fatal do hls.js vira o mesmo evento de erro de um <video> comum
      player.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) video.dispatchEvent(new Event('error'));
      });
      destroy = () => player.destroy();
    },
    () => alive && video.dispatchEvent(new Event('error')),
  );
  return () => {
    alive = false;
    if (destroy) destroy();
    unhold();
  };
}

/** Para o download e solta o elemento. */
export function discardVideo(video: HTMLVideoElement, detach: () => void) {
  detach();
  video.removeAttribute('src');
  video.load();
  if (video.parentNode) video.parentNode.removeChild(video);
}

interface Preloaded {
  key: string;
  url: string;
  /** idioma preferido quando foi guardado */
  audio: string;
  video: HTMLVideoElement;
  detach: () => void;
}

/** um só por vez: a TV tem pouca memória e, muitas vezes, um decodificador só */
let preloaded: Preloaded | null = null;
/** título cuja página de detalhes ainda quer o pré-carregamento */
let wanted: string | null = null;
let releaseTimer = 0;

function dropPreloaded() {
  if (!preloaded) return;
  discardVideo(preloaded.video, preloaded.detach);
  preloaded = null;
}

/**
 * Prepara o play antes do clique: procura as fontes e já começa a baixar a
 * melhor num <video> fora da tela, a partir de onde o espectador parou. Sem
 * tocar. O player adota esse mesmo elemento (takePreloaded) e começa na hora.
 */
export function preloadPlayback(title: Title, season?: number, episode?: number) {
  const key = keyOf(title, season, episode);
  window.clearTimeout(releaseTimer);
  wanted = key;
  // o vídeo guardado ao sair do player deste mesmo episódio já serve, se do mesmo idioma
  if (preloaded && preloaded.key === key && preloaded.audio === audioFor(title)) return;
  dropPreloaded();
  planFor(title, season, episode).then((plan) => {
    if (plan.status === 'play') preloadCandidate(key, title, plan.candidates, season, episode, PRELOAD_TRIES);
  });
}

/** Baixa a primeira fonte que não falhou; se esta falhar, passa para a seguinte. */
function preloadCandidate(
  key: string,
  title: Title,
  candidates: Candidate[],
  season: number | undefined,
  episode: number | undefined,
  tries: number,
) {
  const candidate = candidates.filter((c) => !failedUrls[c.url])[0];
  if (wanted !== key || !candidate || tries <= 0) return;
  if (preloaded && preloaded.url === candidate.url) return;
  dropPreloaded();
  const video = document.createElement('video');
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  const { startAt } = resumePoint(title, season, episode);
  if (startAt > 0) {
    const seek = () => {
      video.removeEventListener('loadedmetadata', seek);
      if (startAt < video.duration) video.currentTime = startAt;
    };
    video.addEventListener('loadedmetadata', seek);
  }
  const fail = () => {
    video.removeEventListener('error', fail);
    failedUrls[candidate.url] = true;
    if (preloaded && preloaded.video === video) {
      dropPreloaded();
      preloadCandidate(key, title, candidates, season, episode, tries - 1);
    }
  };
  video.addEventListener('error', fail);
  // Tocou: em série, vira a fonte dos outros episódios.
  const works = () => {
    video.removeEventListener('canplay', works);
    if (season != null) rememberSource(title.id, candidate.profile);
  };
  video.addEventListener('canplay', works);
  const detach = () => {
    video.removeEventListener('error', fail);
    video.removeEventListener('canplay', works);
    unhook();
  };
  const unhook = attachSource(video, candidate.url, candidate.hls);
  preloaded = { key, url: candidate.url, audio: audioFor(title), video, detach };
}

/**
 * A página de detalhes saiu: se o player não adotar o vídeo logo, ele é
 * descartado, e os torrents que ficaram abertos sem vídeo saem do motor.
 */
export function releasePreload() {
  wanted = null;
  window.clearTimeout(releaseTimer);
  releaseTimer = window.setTimeout(() => {
    dropPreloaded();
    if (!wanted) sweepTorrents();
  }, RELEASE_AFTER_MS);
}

/**
 * O player pega o vídeo pré-carregado (ou guardado) desta fonte, se houver.
 * Se o guardado é de outra, sai: um vídeo por vez.
 */
export function takePreloaded(url: string): { video: HTMLVideoElement; detach: () => void } | null {
  if (!preloaded) return null;
  if (preloaded.url !== url) {
    dropPreloaded();
    return null;
  }
  const taken = preloaded;
  preloaded = null;
  window.clearTimeout(releaseTimer);
  return { video: taken.video, detach: taken.detach };
}

/**
 * O player saiu: o vídeo que estava tocando fica guardado, pausado e com o que
 * já baixou, para o mesmo episódio recomeçar na hora. Não guarda vídeo com
 * erro ou que nem começou, nem passa por cima do pré-carregamento de outro
 * título. Devolve false quando não guardou (quem chamou descarta).
 */
export function parkVideo(
  title: Title,
  season: number | undefined,
  episode: number | undefined,
  url: string,
  video: HTMLVideoElement,
  detach: () => void,
): boolean {
  const key = keyOf(title, season, episode);
  if ((wanted && wanted !== key) || video.error || video.readyState < 2) return false;
  dropPreloaded();
  video.pause();
  if (video.parentNode) video.parentNode.removeChild(video);
  preloaded = { key, url, audio: audioFor(title), video, detach };
  window.clearTimeout(releaseTimer);
  releaseTimer = window.setTimeout(dropPreloaded, PARK_MS);
  return true;
}
