import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hero } from '../components/Hero';
import { Loading } from '../components/Loading';
import { PageError } from '../components/PageError';
import { Rows, type RowSource } from '../components/Rows';
import { ScrollArea } from '../components/ScrollArea';
import { findEpisode, followingEpisode, resumeEpisode } from '../data/episodes';
import { catalog } from '../data/provider';
import { getAllProgress, isFinished, rememberStill, titleFromSnapshot, type Progress } from '../data/storage';
import { useSyncVersion } from '../data/sync';
import type { Title } from '../data/types';
import { focusElement, rememberedFocus } from '../focus/FocusContext';
import { useKeyHandler } from '../focus/keys';
import { usePageFocus } from '../focus/useFocusable';
import { titlePath, watchPath } from '../nav';
import { preloadPlayback, releasePreload } from '../streams/playback';

/** Episódio que o card de uma série mostra, depois de consultar a lista de episódios. */
interface EpisodeCard {
  season: number;
  episode: number;
  /** imagem do episódio */
  image?: string;
  /** o guardado foi visto até o fim: este é o seguinte */
  next: boolean;
}

/** "T3:E8 · Faltam 12 min" (série) ou "Faltam 40 min" (filme). */
function remainingInfo(p: Progress): string {
  const left = Math.max(1, Math.round((p.duration - p.time) / 60));
  const when = isFinished(p) ? 'Assistido' : p.duration ? `Faltam ${left} min` : 'Continuar';
  return p.season != null && p.episode != null ? `T${p.season}:E${p.episode} · ${when}` : when;
}

/**
 * Continuar assistindo: primeira fileira da Home, em cartões horizontais com a
 * imagem do episódio onde o espectador parou (ou o fotograma do título). Série
 * com o episódio já terminado mostra o seguinte; sem seguinte, sai da fileira.
 * Escolher o card dá play direto.
 */
function continueWatchingRow(
  version: number,
  cards: Record<string, EpisodeCard | 'done'>,
  open: (title: Title, season?: number, episode?: number) => void,
): RowSource | null {
  const saved = getAllProgress();
  // Filme visto até o fim sai da fileira; série, só quando não há próximo episódio.
  const ids = Object.keys(saved)
    .filter(
      (id) =>
        saved[id].title &&
        saved[id].time > 0 &&
        cards[id] !== 'done' &&
        (saved[id].title.type === 'series' || !isFinished(saved[id])),
    )
    .sort((a, b) => saved[b].updatedAt - saved[a].updatedAt);
  if (!ids.length) return null;

  const progress: Record<string, number> = {};
  const images: Record<string, string | undefined> = {};
  const infos: Record<string, string> = {};
  ids.forEach((id) => {
    const p = saved[id];
    const card = cards[id];
    const fallback = p.title.backdrop ?? p.title.poster;
    if (card && card !== 'done' && card.next) {
      images[id] = card.image ?? fallback;
      infos[id] = `T${card.season}:E${card.episode} · Próximo episódio`;
      return;
    }
    progress[id] = p.duration ? Math.min(1, p.time / p.duration) : 0;
    images[id] = (card && card !== 'done' ? card.image : undefined) ?? p.title.still ?? fallback;
    infos[id] = remainingInfo(p);
  });
  return {
    // muda quando chegam dados de outra TV ou sai uma série terminada: a fileira se refaz
    id: `continue-${version}-${ids.length}`,
    title: 'Continuar assistindo',
    style: 'wide',
    items: ids.map((id) => titleFromSnapshot(saved[id].title)),
    progress,
    images,
    infos,
    onSelect: (title) => {
      const { season, episode } = episodeOf(title);
      open(title, season, episode);
    },
    // Foco parado no card: fonte procurada e vídeo baixando do ponto salvo,
    // como o Assistir dos detalhes. O player adota o vídeo e começa na hora.
    onDwell: (title) => {
      const { season, episode } = episodeOf(title);
      warming = title.id;
      // o título completo (idioma, ids) escolhe a mesma fonte que o player vai escolher
      catalog.getTitle(title.type, title.id).then(
        (full) => full && warming === title.id && preloadPlayback(full, season, episode),
        () => undefined,
      );
    },
    onLeave: () => {
      warming = null;
      releasePreload();
    },
  };

  function episodeOf(title: Title) {
    const card = cards[title.id];
    const p = saved[title.id];
    return card && card !== 'done' ? { season: card.season, episode: card.episode } : { season: p.season, episode: p.episode };
  }
}

/** card de Continuar assistindo com o vídeo sendo preparado */
let warming: string | null = null;

interface Loaded {
  featured: Title[];
  rows: RowSource[];
}

export default function Home() {
  const navigate = useNavigate();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [rowsReady, setRowsReady] = useState(false);
  // voltando com o foco numa fileira (id "fileira|título"), o destaque já abre recolhido
  const [inRows, setInRows] = useState(() => (rememberedFocus() ?? '').indexOf('|') >= 0);
  const version = useSyncVersion();

  const [cards, setCards] = useState<Record<string, EpisodeCard | 'done'>>({});

  // Continuar assistindo vai direto para o player. Por baixo dele fica a tela do
  // título: Voltar sai do player para ela.
  const openContinue = (title: Title, season?: number, episode?: number) => {
    const isEpisode = title.type === 'series' && season != null && episode != null;
    navigate(titlePath(title));
    navigate(isEpisode ? watchPath(title, season, episode) : watchPath(title));
  };

  // Séries de Continuar assistindo: a lista de episódios diz a imagem do
  // episódio e, se ele já terminou, qual vem depois.
  useEffect(() => {
    if (!data) return;
    let alive = true;
    const saved = getAllProgress();
    Object.keys(saved)
      .filter((id) => saved[id].title && saved[id].title.type === 'series' && saved[id].season != null)
      .forEach((id) => {
        const p = saved[id];
        const season = p.season as number;
        const episode = p.episode as number;
        catalog.getSeasons('series', id).then(
          (seasons) => {
            if (!alive || !seasons.length) return;
            let card: EpisodeCard | 'done';
            if (isFinished(p)) {
              const after = followingEpisode(seasons, season, episode);
              card = after
                ? { season: after.season, episode: after.episode.number, image: after.episode.thumbnail, next: true }
                : 'done';
            } else {
              const current = findEpisode(seasons, season, episode);
              card = { season, episode, image: current && current.thumbnail, next: false };
              // guarda para a próxima abertura já mostrar a imagem certa
              if (current && current.thumbnail) rememberStill(id, season, episode, current.thumbnail);
            }
            setCards((c) => ({ ...c, [id]: card }));
          },
          () => undefined,
        );
      });
    return () => {
      alive = false;
    };
  }, [data, version]);

  useEffect(() => {
    let alive = true;
    Promise.all([catalog.getFeatured(), catalog.listRows()]).then(
      ([featured, refs]) => {
        if (!alive) return;
        setData({ featured, rows: refs.map((ref) => ({ ...ref, load: (page) => catalog.loadRow(ref, page) })) });
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

  // Continuar assistindo vem antes de tudo; refeito quando chegam dados de outra TV.
  const rows = useMemo(() => {
    if (!data) return [];
    const resume = continueWatchingRow(version, cards, openContinue);
    return resume ? [resume, ...data.rows] : data.rows;
    // openContinue só usa navigate, estável
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, version, cards]);

  usePageFocus((!!data && rowsReady) || failed);

  // Voltar com a página rolada retorna ao destaque; no destaque, o app trata (sair).
  useKeyHandler((action) => {
    if (action !== 'back') return false;
    const current = document.activeElement;
    if (!current || !current.closest('.rows')) return false;
    return focusElement(document.querySelector<HTMLElement>('[data-focus-id="hero-play"]'));
  });

  const featured = data ? data.featured : [];
  // série começa de onde o espectador parou (sem a lista de episódios ainda, no episódio guardado)
  const play = (t: Title) => {
    if (t.type !== 'series') return navigate(watchPath(t));
    const next = resumeEpisode(t.id, []);
    navigate(watchPath(t, next.season, next.episode));
  };

  return (
    <div className="page" data-focus-main="">
      {failed && <PageError />}
      {!data && !failed && <Loading />}
      {data && (
        <ScrollArea>
          {featured.length > 0 && (
            <Hero
              away={inRows}
              onFocus={() => setInRows(false)}
              titles={featured}
              onPlay={play}
              onInfo={(t) => navigate(titlePath(t))}
            />
          )}
          <Rows
            rows={rows}
            autoFocusFirst={featured.length === 0}
            onFocus={() => setInRows(true)}
            onReady={() => setRowsReady(true)}
          />
        </ScrollArea>
      )}
    </div>
  );
}
