import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Splash } from './components/Splash';
import { Stage } from './components/Stage';
import { FocusProvider } from './focus/FocusContext';
import { useKeyHandler } from './focus/keys';
import { useGoBack } from './nav';
import AddSource from './pages/AddSource';
import Browse from './pages/Browse';
import Details from './pages/Details';
import Home from './pages/Home';
import MyList from './pages/MyList';
import Search from './pages/Search';
import Settings from './pages/Settings';
import Watch from './pages/Watch';
import { exitApp, registerMediaKeys } from './platform/tizen';
import { installDefaultSources } from './streams/sources';
import { startSync } from './data/sync';

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
  const endOpening = useCallback(() => setOpening(false), []);

  useEffect(() => {
    registerMediaKeys();
    installDefaultSources();
    startSync();
  }, []);

  // Voltar: título e player retornam uma tela, seções vão ao Início, o Início sai do app.
  useKeyHandler((action) => {
    if (action !== 'back') return false;
    if (pathname === '/') exitApp();
    else if (pathname.indexOf('/title/') === 0) backWithFade(goBack);
    else if (NESTED.some((prefix) => pathname.indexOf(prefix) === 0)) goBack();
    else navigate('/');
    return true;
  }, -1);

  const inPlayer = pathname.indexOf('/watch/') === 0;

  return (
    <FocusProvider>
      <Stage>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/browse/:kind" element={<Browse />} />
          <Route path="/title/:type/:id" element={<Details />} />
          <Route path="/search" element={<Search />} />
          <Route path="/list" element={<MyList />} />
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
