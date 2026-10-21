import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Backdrop } from '../components/Backdrop';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { PlayerShell } from '../components/PlayerShell';
import { EmbedPlayer, VideoPlayer } from '../components/VideoPlayer';
import { findEpisode, followingEpisode } from '../data/episodes';
import { catalog, previewTitle } from '../data/provider';
import { rememberSource, saveProgress } from '../data/storage';
import { syncProgress, syncStarted } from '../data/sync';
import type { Season, Title, TitleType } from '../data/types';
import { useFocusable, usePageFocus } from '../focus/useFocusable';
import { useGoBack, watchPath } from '../nav';
import {
  firstWorking,
  markFailed,
  mergeCandidates,
  parkVideo,
  planFor,
  resumePoint,
  type Plan,
} from '../streams/playback';
import { audioChoice } from '../streams/rank';
import type { NoSourceReason } from '../streams/resolve';

const MESSAGES: Record<NoSourceReason | 'all-failed', { title: string; text: string; settings?: boolean }> = {
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
};

/** perto do fim do episódio, as fontes do próximo já são procuradas */
const WARM_NEXT_S = 120;

/** Enquanto a fonte é procurada: a mesma cara do player, com o título no alto e só o Voltar. */
function Waiting({ title, subtitle, onExit }: { title: string; subtitle?: string; onExit: () => void }) {
  const back = useFocusable({ autoFocus: true });
  return (
    <div className="shell">
      <div className="shell__top" data-focus-group="">
        <div {...back} className="shell__btn" aria-label="Voltar" onClick={onExit}>
          <Icon name="back" />
        </div>
      </div>
      <div className="shell__spinner" aria-label="Carregando" />
      <div className="shell__heading">
        <div className="shell__title display">{title}</div>
        {subtitle && <div className="shell__subtitle">{subtitle}</div>}
      </div>
    </div>
  );
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
  const [seasons, setSeasons] = useState<{ id: string; list: Season[] } | null>(null);
  /** null enquanto procura a fonte */
  const [plan, setPlan] = useState<Plan | null>(null);
  /**
   * <video> em uso, com a chave de quem o criou: trocando de episódio ou de
   * fonte, o shell novo não pode pegar o anterior (que fica guardado, vivo).
   */
  const [mediaOf, setMediaOf] = useState<{ key: string; el: HTMLVideoElement } | null>(null);
  /** o vídeo já mostrou imagem: o fundo esmaecido da espera sai */
  const [started, setStarted] = useState(false);
  const warmed = useRef('');

  const key = `${type}/${id}/${season}/${episode}`;
  const isEpisode = season != null && episode != null;

  useEffect(() => {
    let alive = true;
    setTitle(null);
    setPlan(null);
    catalog.getTitle(type, id).then(
      (t) => {
        if (!alive) return;
        if (!t) {
          navigate('/', { replace: true });
          return;
        }
        setTitle(t);
        // Se a página de detalhes já procurou (e até pré-carregou), isto volta na hora.
        planFor(t, season, episode).then((next) => alive && setPlan(firstWorking(next, t, season, episode)));
      },
      () => alive && navigate('/', { replace: true }),
    );
    return () => {
      alive = false;
    };
  }, [key, type, id, season, episode, navigate]);

  // Episódios: nome e imagem do que está tocando e qual vem depois.
  useEffect(() => {
    if (type !== 'series') return;
    let alive = true;
    catalog.getSeasons(type, id).then(
      (list) => alive && setSeasons({ id, list }),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [type, id]);

  // Com uma fonte escolhida antes, o plano sai só com o addon dela; as outras chegam depois, como reserva.
  useEffect(() => {
    if (!plan || plan.status !== 'play' || !plan.more) return;
    let alive = true;
    const more = plan.more;
    more.then((list) => {
      if (!alive) return;
      setPlan((p) =>
        p && p.status === 'play' && p.more === more
          ? { ...p, candidates: mergeCandidates(p.candidates, list), more: undefined }
          : p,
      );
    });
    return () => {
      alive = false;
    };
  }, [plan]);

  const playingIndex = plan && plan.status === 'play' ? plan.index : -1;
  const videoKey = `video:${key}:${playingIndex}`;
  const media = mediaOf && mediaOf.key === videoKey ? mediaOf.el : null;

  // O fundo da espera sai assim que o vídeo mostra imagem. Na TV o evento
  // "playing" pode chegar bem depois das primeiras imagens (ou nem chegar, no
  // vídeo pré-carregado); o tempo andando já basta. Sem isso o fundo ficava
  // aparecendo nas faixas pretas de filmes mais largos que a tela.
  useEffect(() => {
    setStarted(false);
    if (!media) return;
    let last = media.currentTime;
    const show = () => setStarted(true);
    // pulo para onde o espectador parou também muda o tempo; só conta o vídeo andando
    const moved = () => {
      if (!media.paused && !media.seeking && media.currentTime > last + 0.05 && media.currentTime - last < 2) show();
      last = media.currentTime;
    };
    media.addEventListener('playing', show);
    media.addEventListener('timeupdate', moved);
    return () => {
      media.removeEventListener('playing', show);
      media.removeEventListener('timeupdate', moved);
    };
  }, [media]);

  // O foco muda de dono a cada estado: Voltar enquanto procura, linha do tempo quando toca.
  usePageFocus(!!title, `${key}:${plan ? plan.status : 'searching'}:${playingIndex}`);

  const list = seasons && seasons.id === id ? seasons.list : [];
  const current = isEpisode ? findEpisode(list, season, episode) : undefined;
  const following = isEpisode ? followingEpisode(list, season, episode) : null;
  const subtitle = isEpisode
    ? `Temporada ${season}, episódio ${episode}${current && current.title ? ` · ${current.title}` : ''}`
    : undefined;
  const thumb = current ? current.thumbnail : undefined;

  // Até a imagem chegar, o fundo do título aparece esmaecido atrás do
  // carregamento. Antes dos detalhes completos chegarem, vale o que a lista já
  // sabia do título: o fundo não fica preto nem por um instante.
  const known = title ?? previewTitle(type, id);
  const veil = known && !started && (!plan || plan.status === 'play') && (
    <div className="player__veil">
      <Backdrop title={known} shade={false} />
    </div>
  );

  if (!title || !plan) {
    return (
      <div className="page player" data-focus-main="">
        {veil}
        <Waiting
          title={title ? title.title : known ? known.title : ''}
          subtitle={subtitle}
          onExit={goBack}
        />
      </div>
    );
  }

  if (plan.status === 'none') {
    const message = MESSAGES[plan.reason];
    return (
      <div className="page player" data-focus-main="">
        <Backdrop title={title} />
        <div className="player__message">
          <p className="player__message-title">{message.title}</p>
          <p className="player__message-text">{message.text}</p>
          <div className="player__message-actions">
            <Button icon="back" id="watch-back" autoFocus onClick={goBack}>
              Voltar
            </Button>
            {message.settings && (
              <Button id="watch-settings" onClick={() => navigate('/settings')}>
                Abrir Configurações
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

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
  const { startAt, duration } = resumePoint(title, season, episode);
  // Legendas são buscadas pelo id IMDb; títulos sem ele ficam sem.
  const imdbId = title.imdbId ?? (/^tt\d+$/.test(title.id) ? title.id : undefined);
  const subtitleId = imdbId ? (isEpisode ? `${imdbId}:${season}:${episode}` : imdbId) : undefined;
  const hasNext = plan.index + 1 < plan.candidates.length;
  // A lista mostra uma linha por opção distinta. Espelhos da mesma opção não
  // aparecem: são a reserva que o player usa sozinho se o primeiro falhar.
  const options = plan.candidates.map((c) => c.label).filter((label, i, all) => all.indexOf(label) === i);
  // Áudios: um por tipo entre as fontes (dublada, original, dual), na ordem da melhor fonte de cada.
  const audioOf = plan.candidates.map((c) => audioChoice(c.profile, title.originalLanguage));
  const audios = audioOf.filter((a, i) => audioOf.map((b) => b.key).indexOf(a.key) === i);
  const audioKeys = audios.map((a) => a.key);
  // Fonte ruim fica marcada: a próxima abertura deste título já começa pela
  // seguinte. Acabou a lista e as outras fontes ainda vão chegar: espera por elas.
  const next = () => {
    markFailed(candidate.url);
    if (hasNext) {
      setPlan({ ...plan, index: plan.index + 1 });
    } else if (plan.more) {
      const more = plan.more;
      more.then((list) =>
        setPlan((p) => {
          if (!p || p.status !== 'play') return p;
          const merged = mergeCandidates(p.candidates, list);
          return merged.length > p.index + 1
            ? { ...p, candidates: merged, index: p.index + 1, more: undefined }
            : { status: 'none', reason: 'all-failed' };
        }),
      );
    } else {
      setPlan({ status: 'none', reason: 'all-failed' });
    }
  };

  const upNext = following
    ? {
        label: `Temporada ${following.season}, episódio ${following.episode.number}`,
        title: following.episode.title,
        thumb: following.episode.thumbnail ?? title.backdrop,
      }
    : undefined;
  // O próximo episódio entra no lugar deste: Voltar continua levando aos detalhes.
  const playNext = following
    ? () => navigate(watchPath(title, following.season, following.episode.number), { replace: true })
    : undefined;

  return (
    <div className="page player" data-focus-main="">
      {veil}
      <VideoPlayer
        key={videoKey}
        url={candidate.url}
        hls={candidate.hls}
        onMedia={(el) => setMediaOf((m) => (el ? { key: videoKey, el } : m && m.key === videoKey ? null : m))}
        onRelease={(video, detach) => parkVideo(title, season, episode, candidate.url, video, detach)}
      />
      <PlayerShell
        key={`shell:${key}:${plan.index}`}
        title={title.title}
        subtitle={subtitle}
        mode="video"
        media={media}
        duration={duration}
        startAt={startAt}
        subtitlesFor={subtitleId ? { type: title.type, videoId: subtitleId } : undefined}
        sources={options}
        sourceIndex={options.indexOf(candidate.label)}
        audios={audios}
        audioIndex={audioKeys.indexOf(audioOf[plan.index].key)}
        onPickAudio={(i) => setPlan({ ...plan, index: audioOf.map((a) => a.key).indexOf(audioKeys[i]) })}
        onPickSource={(option) =>
          setPlan({ ...plan, index: plan.candidates.map((c) => c.label).indexOf(options[option]) })
        }
        // fonte ruim: passa para a próxima sem perguntar
        onFail={plan.candidates.length > 1 || plan.more ? next : undefined}
        // a fonte que tocou vale para os outros episódios: mesmo addon, mesmo áudio
        onStart={() => {
          if (isEpisode) rememberSource(title.id, candidate.profile);
          syncStarted(title, season, episode);
        }}
        onProgress={(time, length, moment) => {
          saveProgress(title, { season, episode, time, duration: length }, thumb);
          syncProgress(title, season, episode, moment);
          // perto do fim, as fontes do próximo episódio já vão sendo procuradas
          if (following && length > 0 && length - time < WARM_NEXT_S && warmed.current !== key) {
            warmed.current = key;
            planFor(title, following.season, following.episode.number);
          }
        }}
        upNext={upNext}
        onNext={playNext}
        onExit={goBack}
      />
    </div>
  );
}
