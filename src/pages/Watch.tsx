import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Backdrop } from '../components/Backdrop';
import { PlayerShell } from '../components/PlayerShell';
import { playbackFor, VideoPlayer } from '../components/VideoPlayer';
import { catalog } from '../data/provider';
import { getProgress, saveProgress } from '../data/storage';
import type { Title } from '../data/types';
import { usePageFocus } from '../focus/useFocusable';
import { useGoBack } from '../nav';

/** Perto do fim, a próxima sessão recomeça do início. */
const RESUME_MARGIN_S = 30;

export default function Watch() {
  const params = useParams();
  const id = params.id ?? '';
  const season = params.season ? Number(params.season) : undefined;
  const episode = params.episode ? Number(params.episode) : undefined;
  const navigate = useNavigate();
  const goBack = useGoBack();
  const [title, setTitle] = useState<Title | null>(null);
  const [media, setMedia] = useState<HTMLVideoElement | null>(null);

  useEffect(() => {
    let alive = true;
    catalog.getTitle(id).then((t) => {
      if (!alive) return;
      if (t) setTitle(t);
      else navigate('/', { replace: true });
    });
    return () => {
      alive = false;
    };
  }, [id, navigate]);

  const key = `${id}/${season}/${episode}`;
  usePageFocus(!!title, key);

  if (!title) return <div className="page player" data-focus-main="" />;

  const playback = playbackFor(title, season, episode);
  const saved = getProgress(id);
  const sameEpisode = saved && saved.season === season && saved.episode === episode;
  const duration = sameEpisode && saved ? saved.duration : title.runtime * 60;
  const startAt = saved && sameEpisode && saved.time < saved.duration - RESUME_MARGIN_S ? saved.time : 0;

  return (
    <div className="page player" data-focus-main="">
      <VideoPlayer
        key={`video:${key}`}
        playback={playback}
        title={title.title}
        onMedia={setMedia}
        placeholder={<Backdrop title={title} shade={false} />}
      />
      <PlayerShell
        key={`shell:${key}`}
        title={title.title}
        subtitle={season != null && episode != null ? `Temporada ${season}, episódio ${episode}` : undefined}
        mode={playback.kind}
        media={media}
        duration={duration}
        startAt={startAt}
        onProgress={(time, length) => saveProgress(id, { season, episode, time, duration: length })}
        onExit={goBack}
      />
    </div>
  );
}
