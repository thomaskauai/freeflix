import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import '@fontsource-variable/archivo/wdth.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import App from './App';

// HashRouter: dentro do .wgt o app roda de file://, sem servidor para rotas.
createRoot(document.getElementById('root')!).render(
  <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
    <App />
  </HashRouter>,
);
