import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Backdrop } from '../components/Backdrop';
import { Button } from '../components/Button';
import { PlayerShell } from '../components/PlayerShell';
import { EmbedPlayer, embedUrlFor, VideoPlayer } from '../components/VideoPlayer';
import { catalog } from '../data/provider';
import { getProgress, saveProgress } from '../data/storage';
import type { Title, TitleType } from '../data/types';
import { usePageFocus } from '../focus/useFocusable';
import { useGoBack } from '../nav';
import { resolvePlayback, type Candidate, type NoSourceReason } from '../streams/resolve';

/** Perto do fim, a próxima sessão recomeça do início. */
const RESUME_MARGIN_S = 30;

type Plan =
  | { status: 'searching' }
  | { status: 'embed'; url: string }
  | { status: 'play'; candidates: Candidate[]; index: number }
  | { status: 'none'; reason: NoSourceReason | 'all-failed' | 'no-file' };

const MESSAGES: Record<NoSourceReason | 'all-failed' | 'no-file', { title: string; text: string; settings?: boolean }> = {
  'no-addons': {
    title: 'Nenhuma fonte de vídeo instalada',
    text: 'O catálogo mostra os títulos; quem traz o vídeo é uma fonte. Adicione uma em Configurações.',
    settings: true,
  },
  'not-found': {
    title: 'Nenhuma fonte tem este título',
    text: 'As fontes instaladas responderam, mas sem vídeo para ele.',
  },
  'torrent-only': {
    title: 'Só há fontes de torrent',
    text: 'As fontes instaladas só devolveram torrents para este título, e o Freeflix não toca torrent.',
    settings: true,
  },
  unreachable: {
    title: 'As fontes não responderam',
    text: 'Confira a conexão e tente de novo.',
  },
  'all-failed': {
    title: 'Nenhuma fonte tocou',
    text: 'As melhores fontes encontradas falharam ao carregar. Tente de novo em alguns minutos.',
  },
  'no-file': {
    title: 'Este episódio não tem vídeo',
    text: 'O catálogo de clássicos só tem alguns capítulos deste seriado.',
  },
};

/** De onde sai o vídeo: embed configurado, arquivo do catálogo embutido, ou as fontes instaladas. */
async function planFor(title: Title, season?: number, episode?: number): Promise<Plan> {
  const embed = embedUrlFor(title.tmdbId, season, episode);
  if (embed) return { status: 'embed', url: embed };

  if (title.videos) {
    const file =
      title.type === 'series'
        ? title.videos.filter((v) => (season ?? 1) === 1 && v.episode === (episode ?? 1))[0]
        : title.videos[0];
    if (!file) return { status: 'none', reason: 'no-file' };
    return {
      status: 'play',
      index: 0,
      candidates: [{ url: file.url, hls: false, label: 'Wikimedia Commons, domínio público' }],
    };
  }

  const found = await resolvePlayback(title, season, episode);
  if ('reason' in found) return { status: 'none', reason: found.reason };
  return { status: 'play', candidates: found.candidates, index: 0 };
}

export default function Watch() {
  const params = useParams();
  const id = params.id ?? '';
  const type: TitleType = params.type === 'series' ? 'series' : 'movie';
  const season = params.season ? Number(params.season) : undefined;
  const episode = params.episode ? Number(params.episode) : undefined;
  const navigate = useNavigate();
  const goBack = useGoBack();
  const [title, setTitle] = useState<Title | null>(null);
  const [plan, setPlan] = useState<Plan>({ status: 'searching' });
  const [media, setMedia] = useState<HTMLVideoElement | null>(null);

  const key = `${type}/${id}/${season}/${episode}`;

  useEffect(() => {
    let alive = true;
    setTitle(null);
    setPlan({ status: 'searching' });
    catalog.getTitle(type, id).then(
      (t) => {
        if (!alive) return;
        if (!t) {
          navigate('/', { replace: true });
          return;
        }
        setTitle(t);
        planFor(t, season, episode).then(
          (next) => alive && setPlan(next),
          () => alive && setPlan({ status: 'none', reason: 'unreachable' }),
        );
      },
      () => alive && navigate('/', { replace: true }),
    );
    return () => {
      alive = false;
    };
  }, [key, type, id, season, episode, navigate]);

  // O foco muda de dono a cada estado: Voltar enquanto procura, play quando toca.
  const playingIndex = plan.status === 'play' ? plan.index : -1;
  usePageFocus(!!title, `${key}:${plan.status}:${playingIndex}`);

  if (!title) return <div className="page player" data-focus-main="" />;

  if (plan.status === 'searching' || plan.status === 'none') {
    const message = plan.status === 'none' ? MESSAGES[plan.reason] : null;
    return (
      <div className="page player" data-focus-main="">
        <Backdrop title={title} />
        <div className="player__message">
          <p className="player__message-title">{message ? message.title : 'Procurando a melhor fonte'}</p>
          <p className="player__message-text">
            {message ? message.text : 'Medindo a rede e comparando as fontes instaladas.'}
          </p>
          <div className="player__message-actions">
            <Button icon="back" id="watch-back" autoFocus onClick={goBack}>
              Voltar
            </Button>
            {message && message.settings && (
              <Button id="watch-settings" onClick={() => navigate('/settings')}>
                Abrir Configurações
              </Button>
            )}
          </div>
        </div>
        {!message && <div className="shell__spinner" aria-label="Procurando" />}
      </div>
    );
  }

  const subtitle = season != null && episode != null ? `Temporada ${season}, episódio ${episode}` : undefined;

  if (plan.status === 'embed') {
    return (
      <div className="page player" data-focus-main="">
        <EmbedPlayer url={plan.url} title={title.title} />
        <PlayerShell
          title={title.title}
          subtitle={subtitle}
          mode="embed"
          media={null}
          duration={0}
          startAt={0}
          onProgress={() => undefined}
          onExit={goBack}
        />
      </div>
    );
  }

  const candidate = plan.candidates[plan.index];
  const saved = getProgress(id);
  const sameEpisode = !!saved && saved.season === season && saved.episode === episode;
  const startAt = saved && sameEpisode && saved.time < saved.duration - RESUME_MARGIN_S ? saved.time : 0;
  const duration = saved && sameEpisode ? saved.duration : (title.runtime ?? 0) * 60;
  const hasNext = plan.index + 1 < plan.candidates.length;
  // A lista mostra uma linha por opção distinta. Espelhos da mesma opção não
  // aparecem: são a reserva que o player usa sozinho se o primeiro falhar.
  const options = plan.candidates.map((c) => c.label).filter((label, i, all) => all.indexOf(label) === i);
  const next = () =>
    setPlan(hasNext ? { ...plan, index: plan.index + 1 } : { status: 'none', reason: 'all-failed' });

  return (
    <div className="page player" data-focus-main="">
      <VideoPlayer key={`video:${key}:${plan.index}`} url={candidate.url} hls={candidate.hls} onMedia={setMedia} />
      <PlayerShell
        key={`shell:${key}:${plan.index}`}
        title={title.title}
        subtitle={subtitle}
        mode="video"
        media={media}
        duration={duration}
        startAt={startAt}
        sources={options}
        sourceIndex={options.indexOf(candidate.label)}
        onPickSource={(option) =>
          setPlan({ ...plan, index: plan.candidates.map((c) => c.label).indexOf(options[option]) })
        }
        // fonte ruim: passa para a próxima sem perguntar
        onFail={plan.candidates.length > 1 ? next : undefined}
        onProgress={(time, length) => saveProgress(title, { season, episode, time, duration: length })}
        onExit={goBack}
      />
    </div>
  );
}
