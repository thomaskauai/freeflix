import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { Loading } from '../components/Loading';
import { ScrollArea } from '../components/ScrollArea';
import { catalog } from '../data/provider';
import type { Title } from '../data/types';
import { useFocusable, usePageFocus } from '../focus/useFocusable';
import { SEARCH_GRID_ANCHOR } from '../styles/tokens';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('');
const DEBOUNCE_MS = 300;
const MAX_QUERY = 30;
/** com menos letras que isso a busca não roda: os resultados seriam quase aleatórios */
const MIN_QUERY = 3;

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
  const restored = useRef(lastQuery.trim().length >= MIN_QUERY);
  const [ready, setReady] = useState(!restored.current);

  useEffect(() => {
    lastQuery = query;
  }, [query]);

  useEffect(() => {
    let alive = true;
    catalog
      .listRows()
      .then((rows) => {
        const row = rows.filter((r) => r.id.indexOf('popular') >= 0)[0] ?? rows[0];
        return row ? catalog.loadRow(row) : [];
      })
      .then(
        (items) => alive && setPopular(items),
        () => undefined,
      );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    setResults(null);
    if (query.trim().length < MIN_QUERY) return;
    let alive = true;
    // Ao voltar de um título a busca refaz na hora, para o foco achar o card de origem.
    const delay = restored.current ? 0 : DEBOUNCE_MS;
    restored.current = false;
    const timer = window.setTimeout(() => {
      catalog.search(query).then(
        (found) => alive && setResults(found),
        () => alive && setResults([]),
      );
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

  const searching = query.trim().length >= MIN_QUERY;
  // Enquanto a busca não volta, a grade fica vazia: populares sob o título de
  // resultados passariam por resposta.
  const shown = searching ? (results ?? []) : popular;

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
          {!searching ? 'Mais buscados' : results ? `Resultados para “${query.trim()}”` : `Buscando “${query.trim()}”`}
        </h2>
        {searching && !results ? (
          <div className="search__loading">
            <Loading label="Buscando" />
          </div>
        ) : searching && results && results.length === 0 ? (
          <div className="empty">
            <p className="empty__title">Nenhum título com “{query.trim()}”</p>
            <p className="empty__text">Tente o título original ou um gênero, como terror ou comédia.</p>
          </div>
        ) : (
          <div className="grid">
            {shown.map((t) => (
              <Card key={t.id} title={t} variant="poster" focusId={`search|${t.id}`} anchor={SEARCH_GRID_ANCHOR} />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
