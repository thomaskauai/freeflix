import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import { useKeyHandler } from '../focus/keys';
import { focusElement } from '../focus/FocusContext';
import { useFocusable, useFocusMove } from '../focus/useFocusable';
import {
  findSubtitles,
  loadSubtitle,
  rememberedSubtitle,
  rememberSubtitle,
  type SubtitleLanguage,
  type SubtitleOption,
} from '../streams/subtitles';
import type { AudioChoice } from '../streams/rank';
import { Icon, type IconName } from './Icon';

const HIDE_AFTER_MS = 4000;
/** toques no mesmo sentido com menos que isso entre eles (ou a tecla segurada) aceleram a passada */
const SEEK_CHAIN_MS = 700;
/**
 * O vídeo só pula quando o espectador para de apertar: enquanto isso a barra
 * mostra o destino. Pular a cada toque faria a fonte recarregar à toa.
 */
const SEEK_COMMIT_MS = 650;
/** o aviso de quanto avançou fica mais um pouco depois do pulo */
const SEEK_FEEDBACK_MS = 1300;
/** o cartão do próximo episódio aparece nesse tanto antes do fim */
const UPNEXT_S = 20;
const SAVE_EVERY_MS = 5000;
/** fonte que não começa a tocar nesse tempo é dada como ruim */
const START_TIMEOUT_MS = 15000;
/** idioma da legenda dos atalhos ("… com legendas") */
const PRESET_SUBTITLE: SubtitleLanguage = 'pt';

/** Segundos por toque: cresce com a sequência no mesmo sentido. */
function seekStep(count: number) {
  if (count <= 3) return 10;
  if (count <= 6) return 20;
  if (count <= 10) return 30;
  if (count <= 16) return 60;
  return 120;
}

export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  // sem padStart: o WebView das TVs mais antigas não tem
  const two = (n: number) => (n < 10 ? `0${n}` : String(n));
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

/** Texto da fala sem marcações (<i>, <font>, {\an8}…); quebras de linha ficam. */
function cueText(cue: VTTCue): string {
  return cue.text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\{[^}]*\}/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function SourceOption({ label, current, onPick }: { label: string; current: boolean; onPick: () => void }) {
  const focus = useFocusable({ autoFocus: current });
  return (
    <div {...focus} className={`shell__option${current ? ' is-current' : ''}`} onClick={onPick}>
      <span className="shell__option-mark">{current && <Icon name="check" />}</span>
      {label}
    </div>
  );
}

/** Atalho de áudio e legenda, embaixo da linha do tempo, como na Netflix. */
function Chip({ label, current, id, onPick }: { label: string; current: boolean; id?: string; onPick: () => void }) {
  const focus = useFocusable({ id });
  return (
    <div {...focus} className={`shell__chip${current ? ' is-current' : ''}`} onClick={onPick}>
      {current && <Icon name="check" />}
      {label}
    </div>
  );
}

interface Preset {
  audio: number;
  subtitle: SubtitleLanguage | null;
  label: string;
}

/**
 * Atalhos como os da Netflix: a dublagem, o original com legenda e a dublagem
 * com legenda. Sem saber os áudios, os atalhos são do áudio que está tocando.
 */
function presetsFor(audios: AudioChoice[], current: number, subtitles: SubtitleOption[] | null): Preset[] {
  const withSubs = !!subtitles && subtitles.some((o) => o.language === PRESET_SUBTITLE);
  let dub = -1;
  let original = -1;
  audios.forEach((a, i) => {
    if (dub < 0 && !a.original && a.lang === PRESET_SUBTITLE) dub = i;
    if (original < 0 && a.original) original = i;
  });
  const list: Preset[] = [];
  const add = (audio: number, subtitle: boolean) => {
    if (audio < 0 || (subtitle && !withSubs)) return;
    const label = audios[audio] ? audios[audio].label : 'Sem legendas';
    list.push({
      audio,
      subtitle: subtitle ? PRESET_SUBTITLE : null,
      label: subtitle ? (audios[audio] ? `${label} com legendas` : 'Com legendas') : label,
    });
  };
  if (dub < 0 && original < 0) {
    add(current, false);
    add(current, true);
    return list;
  }
  add(dub, false);
  add(original, true);
  if (original >= 0 && !withSubs) add(original, false);
  add(dub, true);
  return list;
}

function ShellButton({
  icon,
  label,
  showLabel,
  autoFocus,
  id,
  onClick,
}: {
  icon: IconName;
  label: string;
  showLabel?: boolean;
  autoFocus?: boolean;
  id?: string;
  onClick: () => void;
}) {
  const focus = useFocusable({ autoFocus, id });
  return (
    <div {...focus} className="shell__btn" aria-label={label} onClick={onClick}>
      <Icon name={icon} />
      {showLabel && <span className="shell__btn-label">{label}</span>}
    </div>
  );
}

interface PlayerShellProps {
  title: string;
  subtitle?: string;
  /**
   * video: controla o <video> recebido em `media`.
   * embed: os controles de reprodução são do embed; o shell só mostra título e Voltar.
   */
  mode: 'video' | 'embed';
  media: HTMLVideoElement | null;
  /** segundos; vale até a duração real do arquivo chegar */
  duration: number;
  startAt: number;
  /** fontes encontradas para este título, da melhor para a pior */
  /** onde buscar legendas: tipo e id IMDb (com :temporada:episódio em séries) */
  subtitlesFor?: { type: string; videoId: string };
  sources?: string[];
  sourceIndex?: number;
  onPickSource?: (index: number) => void;
  /** áudios das fontes encontradas; escolher um troca de fonte */
  audios?: AudioChoice[];
  audioIndex?: number;
  onPickAudio?: (index: number) => void;
  /** a fonte não tocou; sem isso, o shell mostra o erro */
  onFail?: () => void;
  /** onde o vídeo está: a cada poucos segundos (tick), ao pausar e ao sair do player */
  onProgress: (time: number, duration: number, moment: 'tick' | 'pause' | 'exit') => void;
  onExit: () => void;
  /** próximo episódio: no fim aparece um cartão com contagem e ele começa sozinho */
  upNext?: { label: string; title: string; thumb?: string };
  onNext?: () => void;
  /** a fonte começou a tocar */
  onStart?: () => void;
}

export function PlayerShell({
  title,
  subtitle,
  mode,
  media,
  duration,
  startAt,
  subtitlesFor,
  sources,
  sourceIndex = 0,
  onPickSource,
  audios = [],
  audioIndex = 0,
  onPickAudio,
  onFail,
  onProgress,
  onExit,
  upNext,
  onNext,
  onStart,
}: PlayerShellProps) {
  const [time, setTime] = useState(startAt);
  const [length, setLength] = useState(duration);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(mode === 'video');
  const [failed, setFailed] = useState(false);
  /** o vídeo já mostrou imagem uma vez */
  const [started, setStarted] = useState(false);
  /** passada em andamento: de onde partiu e aonde vai (o vídeo ainda não pulou) */
  const [seeking, setSeeking] = useState<{ from: number; target: number } | null>(null);
  /** quanto a última passada moveu, para o aviso no meio da tela */
  const [feedback, setFeedback] = useState<number | null>(null);
  const [visible, setVisible] = useState(true);
  /** fala em exibição: a legenda é desenhada pelo app, não pelo navegador */
  const [caption, setCaption] = useState('');
  const [toast, setToast] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  /** null enquanto procura; lista vazia quando não há */
  const [subtitles, setSubtitles] = useState<SubtitleOption[] | null>(null);
  const [subtitleLang, setSubtitleLang] = useState<SubtitleLanguage | null>(null);
  const [subtitleBusy, setSubtitleBusy] = useState(false);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen;

  const timeline = useRef<HTMLDivElement>(null);
  const upNextCard = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>();
  const toastTimer = useRef<number>();
  const commitTimer = useRef<number>();
  const feedbackTimer = useRef<number>();
  const seekingRef = useRef(seeking);
  const chain = useRef({ dir: 0, count: 0, at: 0 });
  const advanced = useRef(false);
  const nextRef = useRef(onNext);
  const startRef = useRef(onStart);
  nextRef.current = upNext ? onNext : undefined;
  startRef.current = onStart;
  const playingRef = useRef(playing);
  const timeRef = useRef(time);
  const lengthRef = useRef(length);
  const progressRef = useRef(onProgress);
  const failRef = useRef(onFail);
  playingRef.current = playing;
  timeRef.current = time;
  lengthRef.current = length;
  progressRef.current = onProgress;
  failRef.current = onFail;

  // Qualquer tecla, movimento do mouse ou toque mostra os controles; eles somem
  // sozinhos só durante a reprodução.
  const wake = useCallback(() => {
    setVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      // com a lista de fontes aberta os controles ficam
      if (playingRef.current && !menuOpenRef.current) setVisible(false);
    }, HIDE_AFTER_MS);
  }, []);

  useEffect(() => {
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('touchstart', wake);
    return () => {
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('touchstart', wake);
      window.clearTimeout(hideTimer.current);
      window.clearTimeout(toastTimer.current);
      window.clearTimeout(commitTimer.current);
      window.clearTimeout(feedbackTimer.current);
    };
  }, [wake]);

  // Um episódio leva ao seguinte uma vez só, seja pelo fim, pela contagem ou pelo clique.
  const goNext = useCallback(() => {
    if (advanced.current || !nextRef.current) return;
    advanced.current = true;
    nextRef.current();
  }, []);

  // O estado do shell espelha o do elemento <video>.
  useEffect(() => {
    if (mode !== 'video' || !media) return;
    let started = false;

    const fail = () => {
      window.clearTimeout(startTimer);
      if (failRef.current) failRef.current();
      else {
        setFailed(true);
        setBuffering(false);
        setPlaying(false);
      }
    };
    // Fonte lenta ou morta não dá erro, só nunca começa: o relógio decide.
    const startTimer = window.setTimeout(() => !started && fail(), START_TIMEOUT_MS);

    const onMeta = () => {
      if (isFinite(media.duration) && media.duration > 0) setLength(media.duration);
      if (startAt > 0 && startAt < media.duration && media.currentTime < 1) media.currentTime = startAt;
    };
    // Na TV o tempo andando é o sinal mais confiável de que o vídeo começou
    // (o pulo para onde o espectador parou também muda o tempo, e não conta).
    let last = media.currentTime;
    const onTime = () => {
      setTime(media.currentTime);
      const step = media.currentTime - last;
      if (!started && !media.paused && !media.seeking && step > 0.05 && step < 2) onReady();
      last = media.currentTime;
    };
    const onPlay = () => {
      setPlaying(true);
      wake();
    };
    const onPause = () => {
      setPlaying(false);
      if (media.currentTime > 0 && !media.ended) progressRef.current(media.currentTime, lengthRef.current, 'pause');
    };
    const onEnded = () => {
      setPlaying(false);
      goNext();
    };
    const onWaiting = () => setBuffering(true);
    const onReady = () => {
      if (!started && startRef.current) startRef.current();
      started = true;
      window.clearTimeout(startTimer);
      setBuffering(false);
      setStarted(true);
    };

    media.addEventListener('loadedmetadata', onMeta);
    media.addEventListener('durationchange', onMeta);
    media.addEventListener('timeupdate', onTime);
    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);
    media.addEventListener('ended', onEnded);
    media.addEventListener('waiting', onWaiting);
    media.addEventListener('playing', onReady);
    media.addEventListener('canplay', onReady);
    media.addEventListener('error', fail);
    if (media.readyState >= 1) onMeta();
    // Se o aparelho recusar o autoplay, fica pausado com o botão de play em foco.
    const autoplay = media.play();
    if (autoplay && autoplay.catch) autoplay.catch(() => undefined);

    return () => {
      window.clearTimeout(startTimer);
      media.removeEventListener('loadedmetadata', onMeta);
      media.removeEventListener('durationchange', onMeta);
      media.removeEventListener('timeupdate', onTime);
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('ended', onEnded);
      media.removeEventListener('waiting', onWaiting);
      media.removeEventListener('playing', onReady);
      media.removeEventListener('canplay', onReady);
      media.removeEventListener('error', fail);
    };
    // startAt só vale para a abertura deste vídeo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, media, wake, goNext]);

  // TV desligada ou app em segundo plano sem fechar: guarda onde parou e, na
  // volta, continua tocando se estava tocando.
  useEffect(() => {
    if (mode !== 'video' || !media) return;
    let wasPlaying = false;
    const onVisibility = () => {
      if (document.hidden) {
        wasPlaying = !media.paused;
        if (timeRef.current > 0) progressRef.current(timeRef.current, lengthRef.current, 'pause');
      } else if (wasPlaying) {
        wasPlaying = false;
        const started = media.play();
        if (started) started.catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [mode, media]);

  useEffect(() => {
    if (mode !== 'video') return;
    const save = window.setInterval(
      () => progressRef.current(timeRef.current, lengthRef.current, 'tick'),
      SAVE_EVERY_MS,
    );
    return () => {
      window.clearInterval(save);
      if (timeRef.current > 0) progressRef.current(timeRef.current, lengthRef.current, 'exit');
    };
  }, [mode]);

  /** dentro do vídeo; sem duração conhecida, só não passa de zero */
  const clampTime = (target: number) =>
    Math.max(0, lengthRef.current > 0 ? Math.min(lengthRef.current, target) : target);

  const seekTo = (target: number) => {
    if (!media) return;
    const next = clampTime(target);
    media.currentTime = next;
    timeRef.current = next;
    setTime(next);
  };

  /**
   * Avança (1) ou volta (-1). Toques seguidos no mesmo sentido, ou a tecla
   * segurada, pulam cada vez mais: 10 s, 20 s, 30 s, 1 min, 2 min por toque. O
   * vídeo só pula quando o espectador solta; até lá a barra mostra o destino.
   */
  const seek = (dir: 1 | -1) => {
    if (!media) return;
    const now = Date.now();
    const c = chain.current;
    c.count = c.dir === dir && now - c.at < SEEK_CHAIN_MS ? c.count + 1 : 1;
    c.dir = dir;
    c.at = now;
    const pending = seekingRef.current;
    const from = pending ? pending.from : media.currentTime;
    const target = clampTime((pending ? pending.target : media.currentTime) + dir * seekStep(c.count));
    const next = { from, target };
    seekingRef.current = next;
    setSeeking(next);
    setFeedback(target - from);
    window.clearTimeout(feedbackTimer.current);
    window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      seekingRef.current = null;
      setSeeking(null);
      seekTo(target);
      feedbackTimer.current = window.setTimeout(() => setFeedback(null), SEEK_FEEDBACK_MS - SEEK_COMMIT_MS);
    }, SEEK_COMMIT_MS);
  };

  // Barra de progresso com mouse ou dedo: clicar pula, arrastar percorre.
  const seekToPointer = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    seekTo(((e.clientX - box.left) / box.width) * lengthRef.current);
    wake();
  };

  const setPlayback = (play: boolean) => {
    if (!media) return;
    if (play) {
      const started = media.play();
      if (started && started.catch) started.catch(() => undefined);
    } else {
      media.pause();
    }
    wake();
  };
  const toggle = () => media && setPlayback(media.paused);

  useKeyHandler((action) => {
    const wasVisible = visible;
    wake();
    // Voltar fecha a lista de fontes antes de sair do player.
    if (menuOpen) {
      if (action === 'back') return closeMenu(), true;
      if (action === 'up' || action === 'down' || action === 'left' || action === 'right' || action === 'ok') {
        return false;
      }
      return true;
    }
    if (action === 'back') return false;
    // OK no cartão do próximo episódio vale mesmo com os controles ocultos
    if (action === 'ok' && showUpNext && document.activeElement === upNextCard.current) return goNext(), true;
    if (mode === 'video') {
      if (action === 'playpause') return toggle(), true;
      if (action === 'play') return setPlayback(true), true;
      if (action === 'pause' || action === 'stop') return setPlayback(false), true;
      if (action === 'ff') return seek(1), true;
      if (action === 'rw') return seek(-1), true;
    }
    // Com os controles ocultos, a primeira tecla só os traz de volta.
    return !wasVisible;
  }, 10);

  // Na linha do tempo, esquerda e direita percorrem o vídeo.
  useFocusMove(timeline, (dir) => {
    if (dir === 'left') return seek(-1), true;
    if (dir === 'right') return seek(1), true;
    return false;
  });

  /** posição mostrada: o destino da passada em andamento, ou onde o vídeo está */
  const shown = seeking ? seeking.target : time;
  const remaining = length > 0 ? length - shown : Infinity;
  const showUpNext = !!upNext && !!onNext && started && !failed && remaining <= UPNEXT_S;

  // O cartão do próximo episódio chega com o foco; a contagem chegando a zero começa o episódio.
  useEffect(() => {
    if (!showUpNext) return;
    focusElement(upNextCard.current);
    wake();
  }, [showUpNext, wake]);

  useEffect(() => {
    if (showUpNext && !seeking && remaining <= 0.5) goNext();
  }, [showUpNext, seeking, remaining, goNext]);

  const showToast = (message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 4500);
  };

  // Tira a legenda em uso: a faixa que este shell pôs no <video> e o arquivo dela.
  const clearSubtitle = () => {
    if (!media) return;
    Array.prototype.slice.call(media.querySelectorAll('track[data-freeflix]')).forEach((t: HTMLTrackElement) => {
      if (t.src.indexOf('blob:') === 0) URL.revokeObjectURL(t.src);
      media.removeChild(t);
    });
    setCaption('');
  };

  const applySubtitle = (option: SubtitleOption | null, announce: boolean) => {
    if (!media) return;
    clearSubtitle();
    setSubtitleLang(option ? option.language : null);
    if (!option) {
      if (announce) showToast('Legendas desligadas.');
      return;
    }
    setSubtitleBusy(true);
    loadSubtitle(option.url).then(
      (src) => {
        const track = document.createElement('track');
        track.kind = 'subtitles';
        track.label = option.label;
        track.srclang = option.language;
        track.src = src;
        track.setAttribute('data-freeflix', '');
        media.appendChild(track);
        // Escondida: o navegador (e a TV) desenharia com tarja própria, que CSS
        // não tira. O app lê a fala da vez e desenha como a Netflix.
        track.track.mode = 'hidden';
        track.track.addEventListener('cuechange', () => {
          const active = track.track.activeCues;
          const lines: string[] = [];
          for (let i = 0; active && i < active.length; i++) lines.push(cueText(active[i] as VTTCue));
          setCaption(lines.join('\n'));
        });
        setSubtitleBusy(false);
        if (announce) showToast(`Legendas: ${option.label}`);
      },
      () => {
        setSubtitleLang(null);
        setSubtitleBusy(false);
        showToast('A legenda não carregou. Tente outro idioma.');
      },
    );
  };

  // Procura as legendas do título assim que há vídeo e religa o idioma usado da última vez.
  useEffect(() => {
    if (mode !== 'video' || !media || !subtitlesFor) return;
    let alive = true;
    findSubtitles(subtitlesFor.type, subtitlesFor.videoId).then(
      (found) => {
        if (!alive) return;
        setSubtitles(found);
        const wanted = rememberedSubtitle();
        const match = found.filter((o) => o.language === wanted)[0];
        if (match) applySubtitle(match, false);
      },
      () => alive && setSubtitles([]),
    );
    return () => {
      alive = false;
      clearSubtitle();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, media, subtitlesFor && subtitlesFor.videoId]);

  const pickSubtitle = (option: SubtitleOption | null) => {
    rememberSubtitle(option ? option.language : null);
    applySubtitle(option, true);
  };

  /** Outro áudio é outra fonte: o player recomeça nela de onde estava, e com a legenda lembrada. */
  const pickAudio = (index: number) => {
    if (index === audioIndex || !onPickAudio) return;
    if (time > 0) onProgress(time, length, 'pause');
    onPickAudio(index);
  };

  const pickPreset = (preset: Preset) => {
    const option = (subtitles ?? []).filter((o) => o.language === preset.subtitle)[0] ?? null;
    if (preset.audio !== audioIndex && onPickAudio) {
      rememberSubtitle(option ? option.language : null);
      pickAudio(preset.audio);
    } else if ((option ? option.language : null) !== subtitleLang) {
      pickSubtitle(option);
    }
  };

  const closeMenu = () => {
    setMenuOpen(false);
    focusElement(document.querySelector<HTMLElement>('[data-focus-id="shell-sources"]'));
  };

  // A lista aberta vira a camada de foco: o controle só anda dentro dela.
  useEffect(() => {
    if (!menuOpen || !menu.current) return;
    focusElement(
      menu.current.querySelector<HTMLElement>('[data-autofocus]') ||
        menu.current.querySelector<HTMLElement>('[data-focusable]'),
    );
  }, [menuOpen, subtitles]);

  // aparece mesmo com uma fonte só, para ver qual está tocando
  const hasSources = !!sources && sources.length > 0 && !!onPickSource;
  const subtitlesTitle = !subtitlesFor
    ? 'Legendas indisponíveis'
    : subtitles === null
      ? 'Procurando legendas'
      : subtitleBusy
        ? 'Carregando legenda'
        : 'Legendas';
  const presets = presetsFor(audios, audioIndex, subtitles);
  const presetNow = presets.filter((p) => p.audio === audioIndex && p.subtitle === subtitleLang)[0];

  const timelineFocus = useFocusable({ autoFocus: true, id: 'shell-timeline' });
  const upNextFocus = useFocusable({ id: 'shell-upnext' });
  const position = length ? Math.min(100, (shown / length) * 100) : 0;
  const hasControls = mode === 'video';

  return (
    <>
      {caption && (
        <div className={`captions${visible || failed ? ' is-raised' : ''}`} aria-live="polite">
          <span>{caption}</span>
        </div>
      )}
      <div
        className={`shell${visible || failed ? '' : ' is-hidden'}${seeking ? ' is-seeking' : ''}`}
      >
        <div className="shell__top" data-focus-group="">
          <ShellButton icon="back" label="Voltar" autoFocus={!hasControls} onClick={onExit} />
        </div>
        {hasControls && (
          <div className="shell__top shell__top--right" data-focus-group="">
            <ShellButton icon="restart" label="Recomeçar do início" onClick={() => seekTo(0)} />
          </div>
        )}

        {menuOpen && sources && onPickSource && (
          // ⚙: barra lateral com a fonte de vídeo e, embaixo, as legendas
          <div ref={menu} className="shell__sidebar" data-focus-layer="" data-native-scroll="">
            <div className="shell__menu-title">Fonte de vídeo</div>
            {sources.map((label, i) => (
              <SourceOption
                key={i}
                label={label}
                current={i === sourceIndex}
                onPick={() => {
                  if (i === sourceIndex) return closeMenu();
                  // a outra fonte recomeça de onde esta estava
                  if (time > 0) onProgress(time, length, 'pause');
                  onPickSource(i);
                }}
              />
            ))}
            <div className="shell__menu-title shell__menu-title--section">{subtitlesTitle}</div>
            <SourceOption label="Desligadas" current={subtitleLang === null} onPick={() => pickSubtitle(null)} />
            {(subtitles ?? []).map((option) => (
              <SourceOption
                key={option.language}
                label={option.label}
                current={subtitleLang === option.language}
                onPick={() => pickSubtitle(option)}
              />
            ))}
          </div>
        )}

        {toast && <div className="shell__toast">{toast}</div>}

        {hasControls && buffering && !failed && feedback === null && (
          <div className="shell__spinner" aria-label="Carregando" />
        )}
        {feedback !== null && (
          <div className={`shell__seek shell__seek--${feedback < 0 ? 'back' : 'forward'}`}>
            <Icon name={feedback < 0 ? 'rewind' : 'forward'} />
            <span>
              {feedback < 0 ? '−' : '+'}
              {formatClock(Math.abs(feedback))}
            </span>
          </div>
        )}
        {failed && (
          <div className="shell__error">
            <p className="shell__error-title">O vídeo não carregou</p>
            <p>Confira a conexão e abra o título de novo.</p>
          </div>
        )}

        <div className="shell__heading">
          <div className="shell__title display">{title}</div>
          {subtitle && <div className="shell__subtitle">{subtitle}</div>}
        </div>

        {hasControls && (
          // Linha do tempo: um alvo de foco só. OK pausa e continua; esquerda e
          // direita percorrem o vídeo.
          <div
            {...timelineFocus}
            ref={timeline}
            className="shell__bottom"
            aria-label={playing ? 'Pausar' : 'Reproduzir'}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              if (target === e.currentTarget || target.closest('.shell__play')) toggle();
            }}
          >
            <div className="shell__btn shell__play">
              <Icon name={playing ? 'pause' : 'play'} />
            </div>
            <div className="shell__time shell__time--elapsed">{formatClock(shown)}</div>
            <div
              className="shell__bar"
              onPointerDown={(e) => {
                // o arrasto continua valendo mesmo se o dedo sair de cima da barra
                e.currentTarget.setPointerCapture(e.pointerId);
                seekToPointer(e);
              }}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) seekToPointer(e);
              }}
            >
              <i style={{ width: `${position}%` }} />
              <b className="shell__knob" style={{ left: `${position}%` }}>
                {seeking && <span className="shell__bubble">{formatClock(shown)}</span>}
              </b>
            </div>
            <div className="shell__time shell__time--total">{formatClock(length)}</div>
          </div>
        )}

        {hasControls && (
          <div className="shell__chips" data-focus-group="">
            {presets.map((p) => (
              <Chip key={p.label} label={p.label} current={p === presetNow} onPick={() => pickPreset(p)} />
            ))}
            {hasSources && (
              <ShellButton
                icon="settings"
                label="Qualidade e fonte"
                id="shell-sources"
                onClick={() => setMenuOpen(true)}
              />
            )}
          </div>
        )}
      </div>

      {showUpNext && upNext && (
        <div
          {...upNextFocus}
          ref={upNextCard}
          className="upnext"
          aria-label={`Próximo episódio: ${upNext.title}`}
          onClick={goNext}
        >
          <div className="upnext__thumb">
            {upNext.thumb && <img src={upNext.thumb} alt="" decoding="async" />}
            <Icon name="play" />
          </div>
          <div className="upnext__info">
            <span className="upnext__count">Próximo episódio em {Math.max(1, Math.ceil(remaining))}</span>
            <span className="upnext__label">{upNext.label}</span>
            <span className="upnext__title">{upNext.title}</span>
          </div>
          <i
            className="upnext__timer"
            style={{ width: `${Math.min(100, ((UPNEXT_S - remaining) / UPNEXT_S) * 100)}%` }}
          />
        </div>
      )}
    </>
  );
}
