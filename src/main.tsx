import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@fontsource-variable/archivo/wdth.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import App from './App';
import { isTizen } from './platform/tizen';

// A página segue a largura do aparelho (celular, tablet, computador). Na TV o
// WebView desenha em 1920 px, como sempre foi.
if (isTizen()) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.setAttribute('content', 'width=1920, initial-scale=1');
}

// HashRouter: dentro do .wgt o app roda de file://, sem servidor para rotas.
createRoot(document.getElementById('root')!).render(
  <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <App />
  </HashRouter>,
);
