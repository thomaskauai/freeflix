import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Backdrop } from '../components/Backdrop';
import { Button } from '../components/Button';
import { Card, fallbackArt } from '../components/Card';
import { TitleArt } from '../components/Hero';
import { formatRuntime, KindTag, Meta } from '../components/Meta';
import { PageError } from '../components/PageError';
import { Row } from '../components/Row';
import { ScrollArea } from '../components/ScrollArea';
import { catalog } from '../data/provider';
import { getProgress, inMyList, toggleMyList } from '../data/storage';
import type { Episode, Season, Title, TitleType } from '../data/types';
import { useFocusable, usePageFocus } from '../focus/useFocusable';
import { watchPath } from '../nav';
import { ROW_ANCHOR } from '../styles/tokens';

/** altura da fileira de temporadas, que fica visível acima dos episódios */
const SEASONS_ROW = 128;

function EpisodeCard({
  episode,
  still,
  art,
  focusId,
  onSelect,
}: {
  episode: Episode;
  still?: string;
  /** fundo usado quando não há imagem */
  art: string;
  focusId: string;
  onSelect: () => void;
}) {
  const focus = useFocusable({ id: focusId });
  const [failed, setFailed] = useState(false);
  const image = failed ? undefined : (episode.thumbnail ?? still);
  return (
    <div {...focus} className="episode" aria-label={episode.title} onClick={onSelect}>
      <div className="episode__thumb" style={image ? undefined : { background: art }}>
        {image && <img src={image} alt="" onError={() => setFailed(true)} />}
        <span className="episode__number display">{episode.number}</span>
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
  similar: Title[];
}

export default function Details() {
  const params = useParams();
  const id = params.id ?? '';
  const type: TitleType = params.type === 'series' ? 'series' : 'movie';
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [season, setSeason] = useState(1);
  const [listed, setListed] = useState(false);

  useEffect(() => {
    let alive = true;
    setFailed(false);
    Promise.all([catalog.getTitle(type, id), catalog.getSeasons(type, id)]).then(
      ([title, seasons]) => {
        if (!alive) return;
        if (!title) {
          navigate('/', { replace: true });
          return;
        }
        const saved = getProgress(id);
        const first = seasons[0] ? seasons[0].number : 1;
        setSeason(saved && saved.season ? saved.season : first);
        setListed(inMyList(id));
        setLoaded({ id, title, seasons, similar: [] });
        // Semelhantes chegam depois: não seguram a abertura da página.
        catalog.getSimilar(title).then(
          (similar) => alive && setLoaded((prev) => (prev && prev.id === id ? { ...prev, similar } : prev)),
          () => undefined,
        );
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [id, type, navigate]);

  const data = loaded && loaded.id === id ? loaded : null;
  usePageFocus(!!data || failed, id);

  if (failed) {
    return (
      <div className="page details" data-focus-main="">
        <PageError />
      </div>
    );
  }
  if (!data) return <div className="page details" data-focus-main="" />;

  const { title, seasons, similar } = data;
  const saved = getProgress(id);
  const isSeries = title.type === 'series';
  const firstSeason = seasons[0] ? seasons[0].number : 1;
  const resumeSeason = saved && saved.season ? saved.season : firstSeason;
  const resumeEpisode = saved && saved.episode ? saved.episode : 1;
  const current = seasons.filter((s) => s.number === season)[0] ?? seasons[0];
  const manySeasons = seasons.length > 1;

  const play = () => navigate(isSeries ? watchPath(title, resumeSeason, resumeEpisode) : watchPath(title));
  const playLabel = isSeries
    ? `${saved ? 'Continuar' : 'Assistir'} T${resumeSeason} E${resumeEpisode}`
    : saved && saved.time > 0 && saved.time < saved.duration
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
                  onSelect={() => navigate(watchPath(title, current.number, episode.number))}
                />
              ))}
            </Row>
          )}

          {similar.length > 0 && (
            <Row title="Títulos semelhantes" variant="poster">
              {similar.map((t) => (
                <Card key={t.id} title={t} variant="poster" focusId={`similar|${t.id}`} />
              ))}
            </Row>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
