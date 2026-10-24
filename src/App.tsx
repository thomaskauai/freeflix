import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Splash } from './components/Splash';
import { Stage } from './components/Stage';
import { FocusProvider } from './focus/FocusContext';
import { useKeyHandler } from './focus/keys';
import { getPlayerSession } from './data/storage';
import { useGoBack } from './nav';
import AddSource from './pages/AddSource';
import Browse from './pages/Browse';
import Details from './pages/Details';
import Home from './pages/Home';
import MyList from './pages/MyList';
import Search from './pages/Search';
import Settings from './pages/Settings';
import Watch from './pages/Watch';
import { PageActiveContext } from './pageActive';
import { exitApp, isLegacyTizen, registerMediaKeys } from './platform/tizen';
import { installDefaultSources } from './streams/sources';
import { startSync } from './data/sync';

/** player aberto há mais tempo que isso quando o app fechou não é retomado */
const RESUME_PLAYER_WITHIN_MS = 24 * 60 * 60 * 1000;

/** telas abertas a partir de outra: Voltar retorna a ela, não ao Início */
const NESTED = ['/title/', '/watch/', '/settings/'];

/**
 * Voltar dos detalhes: a tela some num fade curto antes de a anterior ser
 * montada. Montar a Home leva quase um segundo na TV, e sem resposta na hora
 * parecia que o controle não tinha funcionado. A de destino entra com outro fade.
 */
const LEAVE_MS = 150;
const ARRIVE_MS = 250;
let leaving = false;

/** Voltar para a página guardada por baixo: ela já está pronta, só reaparece (com fade, fora da TV antiga). */
function backToKept(goBack: () => void) {
  const root = document.documentElement;
  goBack();
  if (isLegacyTizen()) return;
  root.classList.add('is-arriving');
  window.setTimeout(() => root.classList.remove('is-arriving'), ARRIVE_MS);
}

/**
 * Páginas-base (Início, Filmes, Séries, Minha lista): ao abrir detalhes ou o
 * player, a base continua montada por baixo, escondida (display: none não
 * pinta nem ocupa a placa de vídeo). Voltar só a mostra de novo, como no app
 * da Netflix e do YouTube, sem remontar fileiras e imagens.
 */
const isBase = (path: string) => path === '/' || path.indexOf('/browse/') === 0 || path === '/list';
/** telas que abrem por cima da base sem desmontá-la */
const OVER_BASE = ['/title/', '/watch/'];

function backWithFade(goBack: () => void) {
  if (leaving) return;
  leaving = true;
  const root = document.documentElement;
  root.classList.add('is-leaving');
  window.setTimeout(() => {
    goBack();
    root.classList.remove('is-leaving');
    root.classList.add('is-arriving');
    leaving = false;
    window.setTimeout(() => root.classList.remove('is-arriving'), ARRIVE_MS);
  }, LEAVE_MS);
}

export default function App() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const [opening, setOpening] = useState(true);
  // última página-base aberta; segue montada enquanto detalhes ou player estão por cima
  const [kept, setKept] = useState<string | null>(isBase(pathname) ? pathname : null);
  useEffect(() => {
    if (isBase(pathname)) setKept(pathname);
    else if (!OVER_BASE.some((prefix) => pathname.indexOf(prefix) === 0)) setKept(null);
  }, [pathname]);
  const inPlayer = pathname.indexOf('/watch/') === 0;
  const onBase = isBase(pathname);
  // TV antiga: no player a base sai da memória, para sobrar para o vídeo
  const base = onBase ? pathname : kept && !(inPlayer && isLegacyTizen()) ? kept : null;
  const endOpening = useCallback(() => setOpening(false), []);

  useEffect(() => {
    registerMediaKeys();
    installDefaultSources();
    startSync();
    // O app fechou (ou a TV desligou) com o player aberto: volta para ele, do
    // ponto salvo. Detalhes e Início ficam por baixo, para o Voltar de sempre.
    const session = getPlayerSession();
    const match = session && pathname === '/' ? session.path.match(/^\/watch\/(movie|series)\/([^/]+)/) : null;
    if (session && match && Date.now() - session.at < RESUME_PLAYER_WITHIN_MS) {
      navigate(`/title/${match[1]}/${match[2]}`);
      navigate(session.path);
    }
    // só na abertura do app
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Voltar: título e player retornam uma tela, seções vão ao Início, o Início sai do app.
  useKeyHandler((action) => {
    if (action !== 'back') return false;
    if (pathname === '/') exitApp();
    else if (pathname.indexOf('/title/') === 0) (base ? backToKept : backWithFade)(goBack);
    else if (NESTED.some((prefix) => pathname.indexOf(prefix) === 0)) goBack();
    else navigate('/');
    return true;
  }, -1);

  return (
    <FocusProvider>
      <Stage>
        {base && (
          <PageActiveContext.Provider value={onBase}>
            <div
              className="page-layer"
              data-page-hidden={onBase ? undefined : ''}
              style={onBase ? undefined : { display: 'none' }}
            >
              <Routes location={base}>
                <Route path="/" element={<Home />} />
                <Route path="/browse/:kind" element={<Browse />} />
                <Route path="/list" element={<MyList />} />
              </Routes>
            </div>
          </PageActiveContext.Provider>
        )}
        <Routes>
          <Route path="/" element={null} />
          <Route path="/browse/:kind" element={null} />
          <Route path="/list" element={null} />
          <Route path="/title/:type/:id" element={<Details />} />
          <Route path="/search" element={<Search />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/settings/add-source" element={<AddSource />} />
          <Route path="/watch/:type/:id" element={<Watch />} />
          <Route path="/watch/:type/:id/:season/:episode" element={<Watch />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {!inPlayer && <Sidebar />}
        {opening && <Splash onDone={endOpening} />}
      </Stage>
    </FocusProvider>
  );
}
