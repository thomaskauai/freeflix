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
  type EpisodeProgress,
} from '../data/storage';
import type { Episode, Season, Title, TitleType } from '../data/types';
import { focusElement, rememberedFocus } from '../focus/FocusContext';
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
  progress,
  onSelect,
  onDwell,
}: {
  episode: Episode;
  still?: string;
  /** fundo usado quando não há imagem */
  art: string;
  focusId: string;
  /** quanto já foi visto deste episódio neste aparelho */
  progress?: EpisodeProgress;
  onSelect: () => void;
  /** o foco ficou um tempo aqui */
  onDwell: () => void;
}) {
  const focus = useFocusable({ id: focusId });
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
          <span className="episode__watched">
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

/** "episode:3:8" -> temporada 3 */
const seasonOfFocus = (focusId: string) => Number(focusId.split(':')[1]);

export default function Details() {
  const params = useParams();
  const id = params.id ?? '';
  const type: TitleType = params.type === 'series' ? 'series' : 'movie';
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [similar, setSimilar] = useState<{ id: string; items: Title[] } | null>(null);
  const [failed, setFailed] = useState(false);
  // O servidor do catálogo leva segundos para devolver os detalhes. Enquanto
  // isso, a página já abre com a prévia; duração e episódios chegam depois.
  const preview = useMemo(() => previewTitle(type, id), [type, id]);
  const [season, setSeason] = useState(1);
  const [listed, setListed] = useState(false);
  // Voltando do player, o foco vai para o episódio que estava tocando; ele só
  // existe na tela quando os episódios chegam, então a página guarda o pedido.
  const returnTo = useMemo(() => {
    const remembered = rememberedFocus();
    return remembered && remembered.indexOf('episode:') === 0 ? remembered : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
        setSeason(returnTo ? seasonOfFocus(returnTo) : resumeEpisode(id, seasons).season);
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

  // Episódios na tela: se o espectador não mexeu no foco, ele vai para o episódio de onde voltou.
  useEffect(() => {
    if (!data || !returnTo) return;
    const active = document.activeElement as HTMLElement | null;
    const untouched = !active || active === document.body || active.getAttribute('data-focus-id') === 'details-play';
    if (untouched) focusElement(document.querySelector<HTMLElement>(`[data-focus-id="${returnTo}"]`));
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
  const isSeries = title.type === 'series';
  const resume = resumeEpisode(id, seasons);
  const episodes = isSeries ? getEpisodeProgress(id) : {};
  // progresso guardado antes de existir o histórico por episódio vale para o episódio dele
  const resumeProgress =
    episodeProgressOf(episodes, resume.season, resume.episode) ??
    (saved && saved.season === resume.season && saved.episode === resume.episode ? saved : undefined);
  const resuming = !!resumeProgress && resumeProgress.time > 0 && !isFinished(resumeProgress);
  const current = seasons.filter((s) => s.number === season)[0] ?? seasons[0];
  const manySeasons = seasons.length > 1;

  const play = () => navigate(isSeries ? watchPath(title, resume.season, resume.episode) : watchPath(title));
  const playLabel = isSeries
    ? `${resuming ? 'Continuar' : 'Assistir'} T${resume.season} E${resume.episode}`
    : saved && saved.time > 0 && !isFinished(saved)
      ? 'Continuar'
      : 'Assistir';

  return (
    <div className="page details" data-focus-main="">
      <ScrollArea key={id}>
        <div className="details__top" data-scroll-anchor="top">
          <Backdrop title={title} />
          <div className="details__body">
            <KindTag type={title.type} />
            <TitleArt title={title} className="details__title" />
            {title.originalTitle && title.originalTitle !== title.title && (
              <p className="details__original">{title.originalTitle}</p>
            )}
            <Meta title={title} />
            <p className="details__synopsis">{title.synopsis}</p>
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
                  progress={episodeProgressOf(episodes, current.number, episode.number)}
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
