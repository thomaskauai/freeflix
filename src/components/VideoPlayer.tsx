import type { ReactNode } from 'react';
import type { Title } from '../data/types';

export type Playback =
  | { kind: 'video'; url: string }
  | { kind: 'embed'; url: string }
  /** sem fonte: só a prévia com controles simulados */
  | { kind: 'none' };

/**
 * URL do embed: {base}/embed/{tmdbId} ou {base}/embed/{tmdbId}/{temporada}/{episódio}.
 * A base vem de VITE_EMBED_BASE_URL; sem ela não há embed.
 */
export function embedUrlFor(tmdbId: number | null, season?: number, episode?: number): string | null {
  const base = ((import.meta.env.VITE_EMBED_BASE_URL as string | undefined) ?? '').replace(/\/$/, '');
  if (!base || tmdbId == null) return null;
  const path = season != null && episode != null ? `/embed/${tmdbId}/${season}/${episode}` : `/embed/${tmdbId}`;
  return `${base}${path}`;
}

/**
 * De onde sai o vídeo de um título: o embed, se houver um configurado; senão o
 * arquivo do catálogo (em seriados, o do capítulo pedido); senão nada.
 */
export function playbackFor(title: Title, season?: number, episode?: number): Playback {
  const embed = embedUrlFor(title.tmdbId, season, episode);
  if (embed) return { kind: 'embed', url: embed };

  const videos = title.videos ?? [];
  const file =
    title.type === 'series'
      ? videos.filter((v) => (season ?? 1) === 1 && v.episode === (episode ?? 1))[0]
      : videos[0];
  return file ? { kind: 'video', url: file.url } : { kind: 'none' };
}

interface VideoPlayerProps {
  playback: Playback;
  title: string;
  /** recebe o elemento <video> para o PlayerShell controlar */
  onMedia: (media: HTMLVideoElement | null) => void;
  /** mostrado quando não há fonte de vídeo */
  placeholder?: ReactNode;
}

export function VideoPlayer({ playback, title, onMedia, placeholder }: VideoPlayerProps) {
  if (playback.kind === 'embed') {
    return <iframe className="player__frame" src={playback.url} allowFullScreen title={title} />;
  }
  if (playback.kind === 'video') {
    return <video ref={onMedia} className="player__video" src={playback.url} autoPlay playsInline preload="auto" />;
  }
  return <>{placeholder ?? null}</>;
}
