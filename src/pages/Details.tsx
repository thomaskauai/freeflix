import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Backdrop } from '../components/Backdrop';
import { Button } from '../components/Button';
import { Card, fallbackArt } from '../components/Card';
import { Icon } from '../components/Icon';
import { TitleArt } from '../components/Hero';
import { Loading } from '../components/Loading';
import { formatRuntime, KindTag, Meta } from '../components/Meta';
import { PageError } from '../components/PageError';
import { Row } from '../components/Row';
import { ScrollArea } from '../components/ScrollArea';
import { resumeEpisode } from '../data/episodes';
import { catalog, previewTitle } from '../data/provider';
import {
  episodeProgressOf,
  getEpisodeProgress,
  getProgress,
  inMyList,
  isFinished,
  toggleMyList,
  wasFinished,
  type EpisodeProgress,
} from '../data/storage';
import { useSyncVersion } from '../data/sync';
import type { Episode, Season, Title, TitleType } from '../data/types';
import { focusElement, forgetPage } from '../focus/FocusContext';
import { useFocusable, usePageFocus } from '../focus/useFocusable';
import { watchPath } from '../nav';
import { planFor, preloadPlayback, releasePreload } from '../streams/playback';
import { ROW_ANCHOR } from '../styles/tokens';

/** altura da fileira de temporadas, que fica visível acima dos episódios */
const SEASONS_ROW = 128;
/** parado num episódio por esse tempo, as fontes dele já são procuradas */
const WARM_AFTER_MS = 700;

function EpisodeCard({
  episode,
  still,
  art,
  focusId,
  isDefault,
  progress,
  onSelect,
  onDwell,
}: {
  episode: Episode;
  still?: string;
  /** fundo usado quando não há imagem */
  art: string;
  focusId: string;
  /** episódio da vez: descendo até a fileira, o foco cai nele */
  isDefault?: boolean;
  /** quanto já foi visto deste episódio neste aparelho */
  progress?: EpisodeProgress;
  onSelect: () => void;
  /** o foco ficou um tempo aqui */
  onDwell: () => void;
}) {
  const focus = useFocusable({ id: focusId, isDefault });
  const [failed, setFailed] = useState(false);
  const dwell = useRef(0);
  useEffect(() => () => window.clearTimeout(dwell.current), []);
  const image = failed ? undefined : (episode.thumbnail ?? still);
  const watched = !!progress && isFinished(progress);
  const partial = !watched && !!progress && progress.time > 0 && progress.duration > 0;
  return (
    <div
      {...focus}
      className={`episode${watched ? ' is-watched' : ''}`}
      aria-label={watched ? `${episode.title}, assistido` : episode.title}
      onClick={onSelect}
      onFocus={() => {
        window.clearTimeout(dwell.current);
        dwell.current = window.setTimeout(onDwell, WARM_AFTER_MS);
      }}
      onBlur={() => window.clearTimeout(dwell.current)}
    >
      <div className="episode__thumb" style={image ? undefined : { background: art }}>
        {image && <img src={image} alt="" decoding="async" onError={() => setFailed(true)} />}
        <span className="episode__number display">{episode.number}</span>
        {watched && (
          <span className="watched-tag episode__watched">
            <Icon name="check" />
            Assistido
          </span>
        )}
        {(watched || partial) && progress && (
          <div className="episode__progress">
            <i style={{ width: `${watched ? 100 : Math.min(100, (progress.time / progress.duration) * 100)}%` }} />
          </div>
        )}
      </div>
      <div className="episode__info">
        <span className="episode__title">{episode.title}</span>
        {episode.runtime && <span>{formatRuntime(episode.runtime)}</span>}
      </div>
    </div>
  );
}

interface Loaded {
  id: string;
  title: Title;
  seasons: Season[];
}

export default function Details() {
  const params = useParams();
  const id = params.id ?? '';
  const type: TitleType = params.type === 'series' ? 'series' : 'movie';
  const navigate = useNavigate();
  // posições e episódios vistos em outra TV da casa redesenham a página
  useSyncVersion();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [similar, setSimilar] = useState<{ id: string; items: Title[] } | null>(null);
  const [failed, setFailed] = useState(false);
  // O servidor do catálogo leva segundos para devolver os detalhes. Enquanto
  // isso, a página já abre com a prévia; duração e episódios chegam depois.
  const preview = useMemo(() => previewTitle(type, id), [type, id]);
  const [season, setSeason] = useState(1);
  const [listed, setListed] = useState(false);
  // Ao abrir (ou voltar do player), o foco é sempre do botão de assistir: a
  // página não devolve o foco ao último item usado nela.
  useMemo(() => forgetPage(window.location.hash), [id]);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    setListed(inMyList(id));
    // semelhantes em paralelo, pelos gêneros da prévia, quando houver
    const findSimilar = (title: Title) =>
      catalog.getSimilar(title).then(
        (items) => alive && setSimilar({ id, items }),
        () => undefined,
      );
    const early = previewTitle(type, id);
    if (early && early.genres.length) findSimilar(early);
    Promise.all([catalog.getTitle(type, id), catalog.getSeasons(type, id)]).then(
      ([title, seasons]) => {
        if (!alive) return;
        if (!title) {
          navigate('/', { replace: true });
          return;
        }
        setSeason(resumeEpisode(id, seasons).season);
        setLoaded({ id, title, seasons });
        if (!early || !early.genres.length) findSimilar(title);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [id, type, navigate]);

  const data = loaded && loaded.id === id ? loaded : null;
  const shown = data ? data.title : preview;
  usePageFocus(!!shown || failed, id);

  // Série: ↓ nos botões do topo vai direto ao episódio da vez (o em andamento,
  // ou o 1º da 1ª temporada), já com a temporada dele aberta, sem parar nas
  // temporadas. Elas continuam a um ↑ do episódio.
  const pendingEpisode = useRef<string | null>(null);
  const focusEpisode = (focusId: string) =>
    focusElement(document.querySelector<HTMLElement>(`[data-focus-id="${focusId}"]`));
  const jumpDown = useRef<(target: HTMLElement) => boolean>(() => false);
  jumpDown.current = (target) => {
    if (!data || data.title.type !== 'series' || !target.closest('.details__actions')) return false;
    const next = resumeEpisode(id, data.seasons);
    const focusId = `episode:${next.season}:${next.episode}`;
    if (next.season === season && focusEpisode(focusId)) return true;
    if (!data.seasons.some((s) => s.number === next.season)) return false;
    pendingEpisode.current = focusId;
    setSeason(next.season);
    return true;
  };
  useEffect(() => {
    const listener = (e: Event) => {
      const { dir } = (e as CustomEvent<{ dir: string }>).detail;
      if (dir === 'down' && jumpDown.current(e.target as HTMLElement)) e.preventDefault();
    };
    window.addEventListener('focusmove', listener);
    return () => window.removeEventListener('focusmove', listener);
  }, []);
  // a lista da temporada trocada já está na tela: foca o episódio pedido
  useEffect(() => {
    const focusId = pendingEpisode.current;
    pendingEpisode.current = null;
    if (focusId) focusEpisode(focusId);
  }, [season]);

  // O play do botão principal (filme, ou o episódio de "Assistir/Continuar")
  // já começa aqui: fonte procurada e vídeo baixando, sem tocar. Outro
  // episódio escolhido na lista é procurado só no clique.
  useEffect(() => {
    if (!data) return;
    const { title, seasons } = data;
    if (title.type === 'series') {
      const next = resumeEpisode(id, seasons);
      preloadPlayback(title, next.season, next.episode);
    } else {
      preloadPlayback(title);
    }
    return releasePreload;
    // só quando o título completo chega
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data && data.id]);

  if (failed && !data) {
    return (
      <div className="page details" data-focus-main="">
        <PageError />
      </div>
    );
  }
  if (!shown) {
    return (
      <div className="page details" data-focus-main="">
        <Loading />
      </div>
    );
  }

  const title = shown;
  const seasons = data ? data.seasons : [];
  const similarItems = similar && similar.id === id ? similar.items : [];
  const saved = getProgress(id);
  const movieWatched = title.type === 'movie' && ((!!saved && isFinished(saved)) || wasFinished(id));
  const isSeries = title.type === 'series';
  const resume = resumeEpisode(id, seasons);
  const episodes = isSeries ? getEpisodeProgress(id) : {};
  // progresso guardado antes de existir o histórico por episódio vale para o episódio dele
  const resumeProgress =
    episodeProgressOf(episodes, resume.season, resume.episode) ??
    (saved && saved.season === resume.season && saved.episode === resume.episode ? saved : undefined);
  const resuming = !!resumeProgress && resumeProgress.time > 0 && !isFinished(resumeProgress);
  // série já começada: Continuar, mesmo que o episódio da vez ainda não tenha sido aberto
  const started = Object.keys(episodes).length > 0 || !!saved;
  const current = seasons.filter((s) => s.number === season)[0] ?? seasons[0];
  // série já começada: o texto do topo é o resumo do episódio da vez, quando o catálogo tem
  const resumeOverview =
    isSeries && (resuming || started)
      ? seasons
          .filter((s) => s.number === resume.season)
          .map((s) => s.episodes.filter((e) => e.number === resume.episode)[0]?.overview)[0]
      : undefined;
  const manySeasons = seasons.length > 1;

  const play = () => navigate(isSeries ? watchPath(title, resume.season, resume.episode) : watchPath(title));
  const playLabel = isSeries
    ? `${resuming || started ? 'Continuar' : 'Assistir'} T${resume.season} E${resume.episode}`
    : saved && saved.time > 0 && !isFinished(saved)
      ? 'Continuar'
      : 'Assistir';

  return (
    <div className="page details" data-focus-main="">
      <ScrollArea key={id}>
        <div className="details__top" data-scroll-anchor="top">
          <Backdrop title={title} />
          <div className="details__body">
            <KindTag title={title} />
            <TitleArt title={title} className="details__title" />
            {title.originalTitle && title.originalTitle !== title.title && (
              <p className="details__original">{title.originalTitle}</p>
            )}
            <Meta title={title} />
            {movieWatched && (
              <span className="watched-tag details__watched">
                <Icon name="check" />
                Assistido
              </span>
            )}
            <p className="details__synopsis">{resumeOverview || title.synopsis}</p>
            <div className="details__actions">
              <Button icon="play" id="details-play" autoFocus onClick={play}>
                {playLabel}
              </Button>
              <Button
                icon={listed ? 'check' : 'plus'}
                id="details-list"
                onClick={() => setListed(toggleMyList(title))}
              >
                {listed ? 'Na minha lista' : 'Minha lista'}
              </Button>
            </div>
          </div>
        </div>

        <div className="rows">
          {isSeries && manySeasons && (
            <Row title="Temporadas" variant="pills">
              {seasons.map((s) => (
                <Button
                  key={s.number}
                  variant="pill"
                  id={`season:${s.number}`}
                  selected={s.number === season}
                  isDefault={s.number === season}
                  onClick={() => setSeason(s.number)}
                >
                  Temporada {s.number}
                </Button>
              ))}
            </Row>
          )}

          {isSeries && !data && (
            <div className="details__pending">
              <Loading label="Carregando episódios" />
            </div>
          )}

          {isSeries && current && (
            <Row
              key={`season-${current.number}`}
              title={manySeasons ? `Episódios da temporada ${current.number}` : 'Episódios'}
              variant="episode"
              anchor={manySeasons ? ROW_ANCHOR + SEASONS_ROW : ROW_ANCHOR}
            >
              {current.episodes.map((episode) => (
                <EpisodeCard
                  key={episode.number}
                  episode={episode}
                  still={title.backdrop ?? title.poster}
                  art={fallbackArt(id)}
                  focusId={`episode:${current.number}:${episode.number}`}
                  isDefault={current.number === resume.season && episode.number === resume.episode}
                  progress={
                    episodeProgressOf(episodes, current.number, episode.number) ??
                    (wasFinished(id, current.number, episode.number)
                      ? { time: 0, duration: 0, finished: true }
                      : undefined)
                  }
                  onSelect={() => navigate(watchPath(title, current.number, episode.number))}
                  onDwell={() => data && planFor(data.title, current.number, episode.number)}
                />
              ))}
            </Row>
          )}

          {similarItems.length > 0 && (
            <Row title="Títulos semelhantes" variant="poster">
              {similarItems.map((t) => (
                <Card key={t.id} title={t} variant="poster" focusId={`similar|${t.id}`} />
              ))}
            </Row>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
