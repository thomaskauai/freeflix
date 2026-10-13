import { useCallback, useEffect, useRef, useState } from 'react';
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
import { Icon, type IconName } from './Icon';

const HIDE_AFTER_MS = 4000;
const SEEK_SECONDS = 10;
const SAVE_EVERY_MS = 5000;
/** fonte que não começa a tocar nesse tempo é dada como ruim */
const START_TIMEOUT_MS = 15000;
/** altura das legendas, em % da tela a partir do topo */
const SUBTITLE_LINE = 82;

export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  // sem padStart: o WebView das TVs mais antigas não tem
  const two = (n: number) => (n < 10 ? `0${n}` : String(n));
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
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
  /** a fonte não tocou; sem isso, o shell mostra o erro */
  onFail?: () => void;
  onProgress: (time: number, duration: number) => void;
  onExit: () => void;
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
  onFail,
  onProgress,
  onExit,
}: PlayerShellProps) {
  const [time, setTime] = useState(startAt);
  const [length, setLength] = useState(duration);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(mode === 'video');
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [toast, setToast] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const [subsOpen, setSubsOpen] = useState(false);
  /** null enquanto procura; lista vazia quando não há */
  const [subtitles, setSubtitles] = useState<SubtitleOption[] | null>(null);
  const [subtitleLang, setSubtitleLang] = useState<SubtitleLanguage | null>(null);
  const [subtitleBusy, setSubtitleBusy] = useState(false);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuOpen || subsOpen;

  const playButton = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>();
  const toastTimer = useRef<number>();
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

  // Qualquer tecla ou movimento do mouse mostra os controles; eles somem
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
    return () => {
      window.removeEventListener('mousemove', wake);
      window.clearTimeout(hideTimer.current);
      window.clearTimeout(toastTimer.current);
    };
  }, [wake]);

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
    const onTime = () => setTime(media.currentTime);
    const onPlay = () => {
      setPlaying(true);
      wake();
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onReady = () => {
      started = true;
      window.clearTimeout(startTimer);
      setBuffering(false);
    };

    media.addEventListener('loadedmetadata', onMeta);
    media.addEventListener('durationchange', onMeta);
    media.addEventListener('timeupdate', onTime);
    media.addEventListener('play', onPlay);
    media.addEventListener('pause', onPause);
    media.addEventListener('ended', onPause);
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
      media.removeEventListener('ended', onPause);
      media.removeEventListener('waiting', onWaiting);
      media.removeEventListener('playing', onReady);
      media.removeEventListener('canplay', onReady);
      media.removeEventListener('error', fail);
    };
    // startAt só vale para a abertura deste vídeo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, media, wake]);

  useEffect(() => {
    if (mode !== 'video') return;
    const save = window.setInterval(() => progressRef.current(timeRef.current, lengthRef.current), SAVE_EVERY_MS);
    return () => {
      window.clearInterval(save);
      if (timeRef.current > 0) progressRef.current(timeRef.current, lengthRef.current);
    };
  }, [mode]);

  const seekTo = (target: number) => {
    if (!media) return;
    const next = Math.min(lengthRef.current, Math.max(0, target));
    media.currentTime = next;
    // já vale para o próximo toque: FF repetido soma, não parte do mesmo ponto
    timeRef.current = next;
    setTime(next);
  };
  const seek = (delta: number) => seekTo((media ? media.currentTime : timeRef.current) + delta);

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
    if (menuOpen || subsOpen) {
      if (action === 'back') return closeMenu(), true;
      if (action === 'up' || action === 'down' || action === 'ok') return false;
      return true;
    }
    if (action === 'back') return false;
    if (mode === 'video') {
      if (action === 'playpause') return toggle(), true;
      if (action === 'play') return setPlayback(true), true;
      if (action === 'pause' || action === 'stop') return setPlayback(false), true;
      if (action === 'ff') return seek(SEEK_SECONDS), true;
      if (action === 'rw') return seek(-SEEK_SECONDS), true;
    }
    // Com os controles ocultos, a primeira tecla só os traz de volta.
    return !wasVisible;
  }, 10);

  // No botão de play, esquerda e direita percorrem o vídeo.
  useFocusMove(playButton, (dir) => {
    if (dir === 'left') return seek(-SEEK_SECONDS), true;
    if (dir === 'right') return seek(SEEK_SECONDS), true;
    return false;
  });

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
        // o navegador só mostra a faixa recém-criada se mandarmos
        track.track.mode = 'showing';
        // Por padrão a fala encosta na borda de baixo e corta; sobe para uma
        // faixa segura, acima da barra de progresso.
        track.addEventListener('load', () => {
          const cues = track.track.cues;
          for (let i = 0; cues && i < cues.length; i++) {
            const cue = cues[i] as VTTCue;
            cue.snapToLines = false;
            cue.line = SUBTITLE_LINE;
          }
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
    closeMenu();
  };

  const closeMenu = () => {
    const opener = subsOpen ? 'shell-subtitles' : 'shell-sources';
    setMenuOpen(false);
    setSubsOpen(false);
    focusElement(document.querySelector<HTMLElement>(`[data-focus-id="${opener}"]`));
  };

  // A lista aberta vira a camada de foco: o controle só anda dentro dela.
  useEffect(() => {
    if (!(menuOpen || subsOpen) || !menu.current) return;
    focusElement(
      menu.current.querySelector<HTMLElement>('[data-autofocus]') ||
        menu.current.querySelector<HTMLElement>('[data-focusable]'),
    );
  }, [menuOpen, subsOpen, subtitles]);

  const hasSources = !!sources && sources.length > 1 && !!onPickSource;

  const playFocus = useFocusable({ autoFocus: true });
  const hasControls = mode === 'video';

  return (
    <div className={`shell${visible || failed ? '' : ' is-hidden'}`}>
      <div className="shell__top" data-focus-group="">
        <ShellButton icon="back" label="Voltar" autoFocus={!hasControls} onClick={onExit} />
        {hasControls && (
          <>
            <ShellButton icon="restart" label="Reiniciar" onClick={() => seekTo(0)} />
          </>
        )}
      </div>

      {hasControls && (
        <div className="shell__top shell__top--right" data-focus-group="">
          <ShellButton
            icon="options"
            label="Legendas"
            showLabel
            id="shell-subtitles"
            onClick={() => {
              if (subsOpen) return closeMenu();
              setMenuOpen(false);
              setSubsOpen(true);
            }}
          />
          {hasSources && (
            <ShellButton
              icon="swap"
              label="Fontes"
              showLabel
              id="shell-sources"
              onClick={() => {
                if (menuOpen) return closeMenu();
                setSubsOpen(false);
                setMenuOpen(true);
              }}
            />
          )}
        </div>
      )}

      {menuOpen && sources && onPickSource && (
        <div ref={menu} className="shell__menu" data-focus-layer="">
          <div className="shell__menu-title">Fontes deste título</div>
          {sources.map((label, i) => (
            <SourceOption
              key={i}
              label={label}
              current={i === sourceIndex}
              onPick={() => (i === sourceIndex ? closeMenu() : onPickSource(i))}
            />
          ))}
        </div>
      )}

      {subsOpen && (
        <div ref={menu} className="shell__menu" data-focus-layer="">
          <div className="shell__menu-title">
            {!subtitlesFor
              ? 'Este título não tem legendas disponíveis'
              : subtitles === null
                ? 'Procurando legendas'
                : subtitles.length === 0
                  ? 'Nenhuma legenda encontrada para este título'
                  : subtitleBusy
                    ? 'Carregando legenda'
                    : 'Legendas'}
          </div>
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

      {hasControls && buffering && !failed && <div className="shell__spinner" aria-label="Carregando" />}
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
        <div className="shell__bottom">
          <div
            {...playFocus}
            ref={playButton}
            className="shell__btn shell__play"
            aria-label={playing ? 'Pausar' : 'Reproduzir'}
            onClick={toggle}
          >
            <Icon name={playing ? 'pause' : 'play'} />
          </div>
          <div className="shell__time shell__time--elapsed">{formatClock(time)}</div>
          <div
            className="shell__bar"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              seekTo(((e.clientX - box.left) / box.width) * lengthRef.current);
            }}
          >
            <i style={{ width: `${length ? Math.min(100, (time / length) * 100) : 0}%` }} />
          </div>
          <div className="shell__time shell__time--total">{formatClock(length)}</div>
        </div>
      )}
    </div>
  );
}
