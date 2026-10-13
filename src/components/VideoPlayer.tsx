import { useEffect, useRef } from 'react';

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

export function EmbedPlayer({ url, title }: { url: string; title: string }) {
  return <iframe className="player__frame" src={url} allowFullScreen title={title} />;
}

interface VideoPlayerProps {
  url: string;
  /** lista HLS (.m3u8) */
  hls: boolean;
  /** recebe o elemento <video> para o PlayerShell controlar */
  onMedia: (media: HTMLVideoElement | null) => void;
}

/** <video> nativo. HLS toca direto onde o aparelho suporta (TV); senão, por hls.js. */
export function VideoPlayer({ url, hls, onMedia }: VideoPlayerProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let alive = true;
    let detach: (() => void) | undefined;

    if (hls && !video.canPlayType('application/vnd.apple.mpegurl')) {
      // carregado sob demanda: a maioria das fontes não precisa
      import('hls.js').then(
        ({ default: Hls }) => {
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
          detach = () => player.destroy();
        },
        () => alive && video.dispatchEvent(new Event('error')),
      );
    } else {
      video.src = url;
    }

    onMedia(video);
    return () => {
      alive = false;
      if (detach) detach();
      onMedia(null);
    };
    // onMedia é o setState do Watch, estável
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, hls]);

  return <video ref={ref} className="player__video" autoPlay playsInline preload="auto" />;
}
