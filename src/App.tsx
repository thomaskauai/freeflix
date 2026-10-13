import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { Splash } from './components/Splash';
import { Stage } from './components/Stage';
import { FocusProvider } from './focus/FocusContext';
import { useKeyHandler } from './focus/keys';
import { useGoBack } from './nav';
import Browse from './pages/Browse';
import Details from './pages/Details';
import Home from './pages/Home';
import MyList from './pages/MyList';
import Search from './pages/Search';
import Watch from './pages/Watch';
import { exitApp, registerMediaKeys } from './platform/tizen';

export default function App() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const [opening, setOpening] = useState(true);
  const endOpening = useCallback(() => setOpening(false), []);

  useEffect(() => {
    registerMediaKeys();
  }, []);

  // Voltar: título e player retornam uma tela, seções vão ao Início, o Início sai do app.
  useKeyHandler((action) => {
    if (action !== 'back') return false;
    if (pathname === '/') exitApp();
    else if (pathname.indexOf('/title/') === 0 || pathname.indexOf('/watch/') === 0) goBack();
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
          <Route path="/title/:id" element={<Details />} />
          <Route path="/search" element={<Search />} />
          <Route path="/list" element={<MyList />} />
          <Route path="/watch/:id" element={<Watch />} />
          <Route path="/watch/:id/:season/:episode" element={<Watch />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        {!inPlayer && <Sidebar />}
        {opening && <Splash onDone={endOpening} />}
      </Stage>
    </FocusProvider>
  );
}
