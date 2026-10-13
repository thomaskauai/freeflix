import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { Rows } from '../components/Rows';
import { ScrollArea } from '../components/ScrollArea';
import { catalog } from '../data/provider';
import type { Row, RowFilter } from '../data/types';
import { usePageFocus } from '../focus/useFocusable';

const SECTIONS: Record<string, { filter: RowFilter; heading: string }> = {
  series: { filter: 'series', heading: 'Séries' },
  movies: { filter: 'movie', heading: 'Filmes' },
  new: { filter: 'new', heading: 'Novidades' },
};

export default function Browse() {
  const { kind = '' } = useParams();
  const section = SECTIONS[kind];
  const [loaded, setLoaded] = useState<{ kind: string; rows: Row[] } | null>(null);

  useEffect(() => {
    if (!section) return;
    let alive = true;
    catalog.getRows(section.filter).then((rows) => alive && setLoaded({ kind, rows }));
    return () => {
      alive = false;
    };
  }, [kind, section]);

  const rows = loaded && loaded.kind === kind ? loaded.rows : null;
  usePageFocus(!!rows, kind);

  if (!section) return <Navigate to="/" replace />;

  return (
    <div className="page" data-focus-main="">
      {rows && (
        <ScrollArea key={kind}>
          <div className="page-head">
            <h1 className="page-head__title display">{section.heading}</h1>
          </div>
          <Rows rows={rows} autoFocusFirst keepHeader />
        </ScrollArea>
      )}
    </div>
  );
}
