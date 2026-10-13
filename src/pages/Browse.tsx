import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { PageError } from '../components/PageError';
import { Rows, type RowSource } from '../components/Rows';
import { ScrollArea } from '../components/ScrollArea';
import { catalog } from '../data/provider';
import type { RowFilter } from '../data/types';
import { usePageFocus } from '../focus/useFocusable';

const SECTIONS: Record<string, { filter: RowFilter; heading: string }> = {
  series: { filter: 'series', heading: 'Séries' },
  movies: { filter: 'movie', heading: 'Filmes' },
  new: { filter: 'new', heading: 'Novidades' },
};

export default function Browse() {
  const { kind = '' } = useParams();
  const section = SECTIONS[kind];
  const [loaded, setLoaded] = useState<{ kind: string; rows: RowSource[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [readyFor, setReadyFor] = useState('');

  useEffect(() => {
    if (!section) return;
    let alive = true;
    setFailed(false);
    catalog.listRows(section.filter).then(
      (refs) =>
        alive && setLoaded({ kind, rows: refs.map((ref) => ({ ...ref, load: () => catalog.loadRow(ref) })) }),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [kind, section]);

  const rows = loaded && loaded.kind === kind ? loaded.rows : null;
  usePageFocus((!!rows && readyFor === kind) || failed, kind);

  if (!section) return <Navigate to="/" replace />;

  return (
    <div className="page" data-focus-main="">
      {failed && <PageError />}
      {rows && (
        <ScrollArea key={kind}>
          <div className="page-head">
            <h1 className="page-head__title display">{section.heading}</h1>
          </div>
          <Rows rows={rows} autoFocusFirst keepHeader onReady={() => setReadyFor(kind)} />
        </ScrollArea>
      )}
    </div>
  );
}
