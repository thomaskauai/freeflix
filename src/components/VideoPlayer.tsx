import { useEffect, useRef } from 'react';
import { attachSource, discardVideo, takePreloaded } from '../streams/playback';

export function EmbedPlayer({ url, title }: { url: string; title: string }) {
  return <iframe className="player__frame" src={url} allowFullScreen title={title} />;
}

interface VideoPlayerProps {
  url: string;
  /** lista HLS (.m3u8) */
  hls: boolean;
  /** recebe o elemento <video> para o PlayerShell controlar */
  onMedia: (media: HTMLVideoElement | null) => void;
  /** ao sair, quem quiser guardar o vídeo fica com ele (devolve true); senão é descartado */
  onRelease?: (video: HTMLVideoElement, detach: () => void) => boolean;
}

/**
 * <video> nativo. Se a página de detalhes já pré-carregou esta fonte (ou o
 * player guardou o vídeo ao sair), adota aquele elemento, com o que já baixou;
 * senão cria um.
 */
export function VideoPlayer({ url, hls, onMedia, onRelease }: VideoPlayerProps) {
  const box = useRef<HTMLDivElement>(null);
  const release = useRef(onRelease);
  release.current = onRelease;

  useEffect(() => {
    const parent = box.current;
    if (!parent) return;
    const preloaded = takePreloaded(url);
    const video = preloaded ? preloaded.video : document.createElement('video');
    video.className = 'player__video';
    video.autoplay = true;
    video.setAttribute('playsinline', '');
    parent.appendChild(video);
    const detach = preloaded ? preloaded.detach : attachSource(video, url, hls);

    onMedia(video);
    return () => {
      if (!release.current || !release.current(video, detach)) discardVideo(video, detach);
      onMedia(null);
    };
    // onMedia só muda junto com a chave do componente
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, hls]);

  return <div ref={box} className="player__media" />;
}
