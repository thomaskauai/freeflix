import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hero } from '../components/Hero';
import { Loading } from '../components/Loading';
import { PageError } from '../components/PageError';
import { Rows, type RowSource } from '../components/Rows';
import { ScrollArea } from '../components/ScrollArea';
import { resumeEpisode } from '../data/episodes';
import { catalog } from '../data/provider';
import { getAllProgress, isFinished, titleFromSnapshot } from '../data/storage';
import type { Title } from '../data/types';
import { focusElement } from '../focus/FocusContext';
import { useKeyHandler } from '../focus/keys';
import { usePageFocus } from '../focus/useFocusable';
import { titlePath, watchPath } from '../nav';

function continueWatchingRow(): RowSource | null {
  const saved = getAllProgress();
  // Filme visto até o fim sai da fileira; série fica, porque os detalhes levam ao próximo episódio.
  const ids = Object.keys(saved)
    .filter(
      (id) =>
        saved[id].title &&
        saved[id].time > 0 &&
        (saved[id].title.type === 'series' || !isFinished(saved[id])),
    )
    .sort((a, b) => saved[b].updatedAt - saved[a].updatedAt);
  if (!ids.length) return null;

  const progress: Record<string, number> = {};
  ids.forEach((id) => (progress[id] = saved[id].duration ? Math.min(1, saved[id].time / saved[id].duration) : 0));
  return {
    id: 'continue',
    title: 'Continuar assistindo',
    style: 'poster',
    items: ids.map((id) => titleFromSnapshot(saved[id].title)),
    progress,
  };
}

interface Loaded {
  featured: Title[];
  rows: RowSource[];
}

export default function Home() {
  const navigate = useNavigate();
  const [data, setData] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [rowsReady, setRowsReady] = useState(false);
  const [inRows, setInRows] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([catalog.getFeatured(), catalog.listRows()]).then(
      ([featured, refs]) => {
        if (!alive) return;
        const rows: RowSource[] = refs.map((ref) => ({ ...ref, load: () => catalog.loadRow(ref) }));
        const resume = continueWatchingRow();
        if (resume) rows.splice(1, 0, resume);
        setData({ featured, rows });
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, []);

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
            rows={data.rows}
            autoFocusFirst={featured.length === 0}
            onFocus={() => setInRows(true)}
            onReady={() => setRowsReady(true)}
          />
        </ScrollArea>
      )}
    </div>
  );
}
