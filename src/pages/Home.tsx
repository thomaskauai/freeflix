import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Hero } from '../components/Hero';
import { Rows, type RowWithProgress } from '../components/Rows';
import { ScrollArea } from '../components/ScrollArea';
import { catalog } from '../data/provider';
import { getAllProgress } from '../data/storage';
import type { Title } from '../data/types';
import { focusElement } from '../focus/FocusContext';
import { useKeyHandler } from '../focus/keys';
import { usePageFocus } from '../focus/useFocusable';

async function continueWatchingRow(): Promise<RowWithProgress | null> {
  const saved = getAllProgress();
  const ids = Object.keys(saved)
    .filter((id) => saved[id].time > 0 && saved[id].time < saved[id].duration)
    .sort((a, b) => saved[b].updatedAt - saved[a].updatedAt);
  if (!ids.length) return null;

  const items = await catalog.getTitles(ids);
  const progress: Record<string, number> = {};
  items.forEach((t) => (progress[t.id] = saved[t.id].time / saved[t.id].duration));
  return { id: 'continue', title: 'Continuar assistindo', style: 'poster', items, progress };
}

export default function Home() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ featured: Title; rows: RowWithProgress[] } | null>(null);
  const [inRows, setInRows] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([catalog.getFeatured(), catalog.getRows(), continueWatchingRow()]).then(
      ([featured, rows, resume]) => {
        if (!alive) return;
        const all: RowWithProgress[] = rows.slice();
        if (resume) all.splice(1, 0, resume);
        setData({ featured, rows: all });
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  usePageFocus(!!data);

  // Voltar com a página rolada retorna ao destaque; no destaque, o app trata (sair).
  useKeyHandler((action) => {
    if (action !== 'back') return false;
    const current = document.activeElement;
    if (!current || !current.closest('.rows')) return false;
    return focusElement(document.querySelector<HTMLElement>('[data-focus-id="hero-play"]'));
  });

  return (
    <div className="page" data-focus-main="">
      {data && (
        <ScrollArea>
          <Hero
            away={inRows}
            onFocus={() => setInRows(false)}
            title={data.featured}
            onPlay={() =>
              navigate(data.featured.type === 'series' ? `/watch/${data.featured.id}/1/1` : `/watch/${data.featured.id}`)
            }
            onInfo={() => navigate(`/title/${data.featured.id}`)}
          />
          <Rows rows={data.rows} onFocus={() => setInRows(true)} />
        </ScrollArea>
      )}
    </div>
  );
}
