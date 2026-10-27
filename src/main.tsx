import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@fontsource-variable/archivo/wdth.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import App from './App';
import { isLegacyTizen, isTizen } from './platform/tizen';
import { torrentAvailable } from './streams/torrent';

// A página segue a largura do aparelho (celular, tablet, computador). Na TV o
// WebView desenha em 1920 px, como sempre foi.
if (isTizen()) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.setAttribute('content', 'width=1920, initial-scale=1');
}
if (isLegacyTizen()) document.documentElement.classList.add('is-legacy-tv');
// motor de torrent: na TV já sobe o serviço, para estar pronto no primeiro play
if (isTizen()) torrentAvailable();

// HashRouter: dentro do .wgt o app roda de file://, sem servidor para rotas.
createRoot(document.getElementById('root')!).render(
  <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <App />
  </HashRouter>,
);
