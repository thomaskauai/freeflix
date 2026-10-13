import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { ScrollArea } from '../components/ScrollArea';
import { catalog } from '../data/provider';
import type { Title } from '../data/types';
import { useFocusable, usePageFocus } from '../focus/useFocusable';
import { SEARCH_GRID_ANCHOR } from '../styles/tokens';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const DEBOUNCE_MS = 300;
const MAX_QUERY = 30;

// A busca sobrevive à ida e volta de um título.
let lastQuery = '';

function Key({
  label,
  wide,
  autoFocus,
  onPress,
  children,
}: {
  label: string;
  wide?: boolean;
  autoFocus?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  const focus = useFocusable({ id: `key:${label}`, autoFocus });
  return (
    <div {...focus} className={`key${wide ? ' key--wide' : ''}`} aria-label={label} onClick={onPress}>
      {children}
    </div>
  );
}

export default function Search() {
  const [query, setQuery] = useState(lastQuery);
  const [results, setResults] = useState<Title[] | null>(null);
  const [popular, setPopular] = useState<Title[]>([]);
  const restored = useRef(lastQuery.trim().length > 0);
  const [ready, setReady] = useState(!restored.current);

  useEffect(() => {
    lastQuery = query;
  }, [query]);

  useEffect(() => {
    let alive = true;
    catalog.getRows().then((rows) => {
      const row = rows.filter((r) => r.id === 'popular')[0] ?? rows[0];
      if (alive && row) setPopular(row.items);
    });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    let alive = true;
    // Ao voltar de um título a busca refaz na hora, para o foco achar o card de origem.
    const delay = restored.current ? 0 : DEBOUNCE_MS;
    restored.current = false;
    const timer = window.setTimeout(() => {
      catalog.search(query).then((found) => alive && setResults(found));
    }, delay);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const type = (char: string) => setQuery((q) => (q.length < MAX_QUERY ? q + char : q));
  const erase = () => setQuery((q) => q.slice(0, -1));

  // No computador dá para digitar direto; na TV só existe o teclado da tela.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && !e.metaKey && !e.ctrlKey) type(e.key.toLowerCase());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (results) setReady(true);
  }, [results]);

  usePageFocus(ready);

  const shown = results ?? popular;
  const searching = query.trim().length > 0;

  return (
    <div className="page search" data-focus-main="">
      <div className="search__panel">
        <div className={`search__query${query ? '' : ' search__query--empty'}`}>
          {query || 'Título ou gênero'}
          {query && <span className="search__caret" />}
        </div>
        <div className="keys">
          <Key label="espaço" wide onPress={() => type(' ')}>
            Espaço
          </Key>
          <Key label="apagar" wide onPress={erase}>
            <Icon name="erase" />
          </Key>
          <Key label="limpar" wide onPress={() => setQuery('')}>
            Limpar
          </Key>
          {LETTERS.map((char, i) => (
            <Key key={char} label={char} autoFocus={i === 0} onPress={() => type(char)}>
              {char}
            </Key>
          ))}
        </div>
      </div>

      <ScrollArea className="search__results">
        <h2 className="search__heading">
          {searching ? `Resultados para “${query.trim()}”` : 'Mais buscados'}
        </h2>
        {searching && results && results.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Nenhum título com “{query.trim()}”</p>
            <p className="empty__text">Tente o título original ou um gênero, como terror ou comédia.</p>
          </div>
        ) : (
          <div className="grid">
            {shown.map((t) => (
              <Card key={t.id} title={t} variant="poster" focusId={`search:${t.id}`} anchor={SEARCH_GRID_ANCHOR} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
