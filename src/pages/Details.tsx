import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Backdrop } from '../components/Backdrop';
import { Button } from '../components/Button';
import { Card, fallbackArt } from '../components/Card';
import { formatRuntime, KindTag, Meta } from '../components/Meta';
import { Row } from '../components/Row';
import { ScrollArea } from '../components/ScrollArea';
import { catalog } from '../data/provider';
import { getProgress, inMyList, toggleMyList } from '../data/storage';
import type { Episode, Season, Title } from '../data/types';
import { useFocusable, usePageFocus } from '../focus/useFocusable';
import { ROW_ANCHOR } from '../styles/tokens';

/** altura da faixa de temporadas, que fica visível acima dos episódios */
const SEASONS_STRIP = 78;

function EpisodeCard({
  episode,
  still,
  art,
  focusId,
  onSelect,
}: {
  episode: Episode;
  still?: string;
  /** fundo usado quando o título não tem imagem */
  art: string;
  focusId: string;
  onSelect: () => void;
}) {
  const focus = useFocusable({ id: focusId });
  return (
    <div {...focus} className="episode" aria-label={episode.title} onClick={onSelect}>
      <div className="episode__thumb" style={still ? undefined : { background: art }}>
        {still && <img src={still} alt="" />}
        <span className="episode__number display">{episode.number}</span>
      </div>
      <div className="episode__info">
        <span>{episode.title}</span>
        <span>{formatRuntime(episode.runtime)}</span>
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
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [season, setSeason] = useState(1);
  const [listed, setListed] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([catalog.getTitle(id), catalog.getSeasons(id), catalog.getSimilar(id)]).then(
      ([title, seasons, similar]) => {
        if (!alive) return;
        if (!title) {
          navigate('/', { replace: true });
          return;
        }
        const saved = getProgress(id);
        setSeason(saved && saved.season ? saved.season : 1);
        setListed(inMyList(id));
        setLoaded({ id, title, seasons, similar });
      },
    );
    return () => {
      alive = false;
    };
  }, [id, navigate]);

  const data = loaded && loaded.id === id ? loaded : null;
  usePageFocus(!!data, id);

  if (!data) return <div className="page details" data-focus-main="" />;

  const { title, seasons, similar } = data;
  const saved = getProgress(id);
  const isSeries = title.type === 'series';
  const resumeSeason = saved && saved.season ? saved.season : 1;
  const resumeEpisode = saved && saved.episode ? saved.episode : 1;
  const current = seasons.filter((s) => s.number === season)[0] ?? seasons[0];
  const still = title.backdrop ?? title.poster;

  const play = () => navigate(isSeries ? `/watch/${id}/${resumeSeason}/${resumeEpisode}` : `/watch/${id}`);
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
            <h1 className={`details__title display${title.title.length > 22 ? ' details__title--long' : ''}`}>
              {title.title}
            </h1>
            {title.originalTitle !== title.title && <p className="details__original">{title.originalTitle}</p>}
            <Meta title={title} />
            <p className="details__synopsis">{title.synopsis}</p>
            <div className="details__actions">
              <Button icon="play" id="details-play" autoFocus onClick={play}>
                {playLabel}
              </Button>
              <Button
                icon={listed ? 'check' : 'plus'}
                id="details-list"
                onClick={() => setListed(toggleMyList(id))}
              >
                {listed ? 'Na minha lista' : 'Minha lista'}
              </Button>
            </div>
          </div>
        </div>

        <div className="rows">
          {isSeries && seasons.length > 1 && (
            <div className="seasons" data-scroll-anchor={ROW_ANCHOR}>
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
            </div>
          )}

          {isSeries && current && (
            <Row
              key={`season-${current.number}`}
              title={seasons.length > 1 ? `Episódios da temporada ${current.number}` : 'Episódios'}
              variant="episode"
              anchor={seasons.length > 1 ? ROW_ANCHOR + SEASONS_STRIP : ROW_ANCHOR}
            >
              {current.episodes.map((episode) => (
                <EpisodeCard
                  key={episode.number}
                  episode={episode}
                  still={still}
                  art={fallbackArt(id)}
                  focusId={`episode:${current.number}:${episode.number}`}
                  onSelect={() => navigate(`/watch/${id}/${current.number}/${episode.number}`)}
                />
              ))}
            </Row>
          )}

          {similar.length > 0 && (
            <Row title="Títulos semelhantes" variant="poster">
              {similar.map((t) => (
                <Card key={t.id} title={t} variant="poster" focusId={`similar:${t.id}`} />
              ))}
            </Row>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
