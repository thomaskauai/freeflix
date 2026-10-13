import { useCallback, useEffect, useRef, useState } from 'react';
import { useKeyHandler } from '../focus/keys';
import { useFocusable, useFocusMove } from '../focus/useFocusable';
import { Icon, type IconName } from './Icon';

const HIDE_AFTER_MS = 4000;
const SEEK_SECONDS = 10;
const SAVE_EVERY_MS = 5000;

export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  // sem padStart: o WebView das TVs mais antigas não tem
  const two = (n: number) => (n < 10 ? `0${n}` : String(n));
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`;
}

function ShellButton({
  icon,
  label,
  showLabel,
  autoFocus,
  onClick,
}: {
  icon: IconName;
  label: string;
  showLabel?: boolean;
  autoFocus?: boolean;
  onClick: () => void;
}) {
  const focus = useFocusable({ autoFocus });
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
   * none: sem fonte de vídeo; roda um relógio próprio para os controles serem navegáveis.
   */
  mode: 'video' | 'embed' | 'none';
  media: HTMLVideoElement | null;
  /** segundos; no modo video vale a duração real do arquivo assim que ela chega */
  duration: number;
  startAt: number;
  onProgress: (time: number, duration: number) => void;
  onExit: () => void;
}

export function PlayerShell({ title, subtitle, mode, media, duration, startAt, onProgress, onExit }: PlayerShellProps) {
  const [time, setTime] = useState(startAt);
  const [length, setLength] = useState(duration);
  // No modo video só vira true quando o <video> de fato começa a tocar.
  const [playing, setPlaying] = useState(mode === 'none');
  const [buffering, setBuffering] = useState(mode === 'video');
  const [failed, setFailed] = useState(false);
  const [visible, setVisible] = useState(true);
  const [toast, setToast] = useState(false);

  const playButton = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>();
  const toastTimer = useRef<number>();
  const playingRef = useRef(playing);
  const timeRef = useRef(time);
  const lengthRef = useRef(length);
  const progressRef = useRef(onProgress);
  playingRef.current = playing;
  timeRef.current = time;
  lengthRef.current = length;
  progressRef.current = onProgress;

  // Qualquer tecla mostra os controles; eles somem sozinhos só durante a reprodução.
  const wake = useCallback(() => {
    setVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (playingRef.current) setVisible(false);
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

  // Modo video: o estado do shell espelha o do elemento <video>.
  useEffect(() => {
    if (mode !== 'video' || !media) return;

    const onMeta = () => {
      if (isFinite(media.duration) && media.duration > 0) setLength(media.duration);
      if (startAt > 0 && startAt < media.duration) media.currentTime = startAt;
    };
    const onTime = () => setTime(media.currentTime);
    const onPlay = () => {
      setPlaying(true);
      wake();
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setBuffering(true);
    const onReady = () => setBuffering(false);
    const onError = () => {
      setFailed(true);
      setBuffering(false);
      setPlaying(false);
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
    media.addEventListener('error', onError);
    if (media.readyState >= 1) onMeta();
    // Se a TV recusar o autoplay, fica pausado com o botão de play em foco.
    const started = media.play();
    if (started && started.catch) started.catch(() => setBuffering(false));

    return () => {
      media.removeEventListener('loadedmetadata', onMeta);
      media.removeEventListener('durationchange', onMeta);
      media.removeEventListener('timeupdate', onTime);
      media.removeEventListener('play', onPlay);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('ended', onPause);
      media.removeEventListener('waiting', onWaiting);
      media.removeEventListener('playing', onReady);
      media.removeEventListener('canplay', onReady);
      media.removeEventListener('error', onError);
    };
    // startAt só vale para a abertura deste vídeo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, media, wake]);

  // Modo none: relógio próprio.
  useEffect(() => {
    if (mode !== 'none' || !playing) return;
    const tick = window.setInterval(() => setTime((t) => Math.min(lengthRef.current, t + 1)), 1000);
    return () => window.clearInterval(tick);
  }, [mode, playing]);

  useEffect(() => {
    if (mode === 'none' && time >= length) setPlaying(false);
  }, [mode, time, length]);

  useEffect(() => {
    if (mode === 'embed') return;
    const save = window.setInterval(() => progressRef.current(timeRef.current, lengthRef.current), SAVE_EVERY_MS);
    return () => {
      window.clearInterval(save);
      progressRef.current(timeRef.current, lengthRef.current);
    };
  }, [mode]);

  const seekTo = (target: number) => {
    const next = Math.min(lengthRef.current, Math.max(0, target));
    if (mode === 'video' && media) media.currentTime = next;
    // já vale para o próximo toque: FF repetido soma, não parte do mesmo ponto
    timeRef.current = next;
    setTime(next);
  };
  const seek = (delta: number) =>
    seekTo((mode === 'video' && media ? media.currentTime : timeRef.current) + delta);

  const setPlayback = (play: boolean) => {
    if (mode === 'video' && media) {
      if (play) {
        const started = media.play();
        if (started && started.catch) started.catch(() => undefined);
      } else {
        media.pause();
      }
    } else {
      if (play && timeRef.current >= lengthRef.current) setTime(0);
      setPlaying(play);
    }
    wake();
  };
  const toggle = () => setPlayback(mode === 'video' && media ? media.paused : !playingRef.current);

  useKeyHandler((action) => {
    const wasVisible = visible;
    wake();
    if (action === 'back') return false;
    if (mode !== 'embed') {
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

  const showToast = () => {
    setToast(true);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(false), 3500);
  };

  const playFocus = useFocusable({ autoFocus: true });
  const hasControls = mode !== 'embed';

  return (
    <div className={`shell${visible || failed ? '' : ' is-hidden'}`}>
      <div className="shell__top" data-focus-group="">
        <ShellButton icon="back" label="Voltar" autoFocus={!hasControls} onClick={onExit} />
        {hasControls && (
          <>
            <ShellButton icon="options" label="Opções" showLabel onClick={showToast} />
            <ShellButton icon="restart" label="Reiniciar" onClick={() => seekTo(0)} />
          </>
        )}
      </div>

      {mode === 'none' && <div className="shell__notice">Este título ainda não tem vídeo</div>}
      {toast && <div className="shell__toast">Este vídeo não tem outras faixas de áudio nem legendas.</div>}

      {mode === 'video' && buffering && !failed && <div className="shell__spinner" aria-label="Carregando" />}
      {failed && (
        <div className="shell__error">
          <p className="shell__error-title">O vídeo não carregou</p>
          <p>Confira a conexão da TV e abra o título de novo.</p>
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
