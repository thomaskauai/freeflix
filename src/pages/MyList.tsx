import { useEffect, useState } from 'react';
import { Card } from '../components/Card';
import { ScrollArea } from '../components/ScrollArea';
import { catalog } from '../data/provider';
import { getMyList } from '../data/storage';
import type { Title } from '../data/types';
import { usePageFocus } from '../focus/useFocusable';
import { LIST_GRID_ANCHOR } from '../styles/tokens';

export default function MyList() {
  const [items, setItems] = useState<Title[] | null>(null);

  useEffect(() => {
    let alive = true;
    catalog.getTitles(getMyList()).then((titles) => alive && setItems(titles));
    return () => {
      alive = false;
    };
  }, []);

  usePageFocus(!!items && items.length > 0);

  return (
    <div className="page" data-focus-main="">
      {items && (
        <ScrollArea>
          <div className="page-head">
            <h1 className="page-head__title display">Minha lista</h1>
          </div>
          {items.length === 0 ? (
            <div className="empty" style={{ marginTop: 60 }}>
              <p className="empty__title">Sua lista está vazia</p>
              <p className="empty__text">
                Abra um título e escolha Minha lista. Ele fica guardado aqui, neste aparelho.
              </p>
            </div>
          ) : (
            <div className="grid">
              {items.map((t, i) => (
                <Card
                  key={t.id}
                  title={t}
                  variant="poster"
                  focusId={`list:${t.id}`}
                  autoFocus={i === 0}
                  anchor={LIST_GRID_ANCHOR}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      )}
    </div>
  );
}
