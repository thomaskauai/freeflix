import { useRef, type FocusEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { focusElement, focusPageDefault, forgetPage } from '../focus/FocusContext';
import { useFocusable, useFocusMove } from '../focus/useFocusable';
import { Icon, type IconName } from './Icon';

// Navegação no topo (experimental): perfil (abre Configurações) à esquerda, abas
// no centro (busca, Início, Séries, Filmes, Minha lista) e a marca à direita. A aba da
// página atual fica com fundo cinza; a focada, branca. Para baixo volta ao
// conteúdo onde o foco estava.

const TABS: { path: string; label: string; icon?: IconName }[] = [
  { path: '/search', label: 'Buscar', icon: 'search' },
  { path: '/', label: 'Início' },
  { path: '/browse/series', label: 'Séries' },
  { path: '/browse/movies', label: 'Filmes' },
  { path: '/list', label: 'Minha lista' },
];
const SETTINGS = '/settings';

function Tab({
  label,
  icon,
  active,
  isDefault,
  onSelect,
}: {
  label: string;
  icon?: IconName;
  active: boolean;
  isDefault: boolean;
  onSelect: () => void;
}) {
  const focus = useFocusable({ isDefault });
  return (
    <div
      {...focus}
      className={`topnav__tab${icon ? ' topnav__tab--icon' : ''}${active ? ' is-active' : ''}`}
      aria-label={label}
      onClick={onSelect}
    >
      {icon ? <Icon name={icon} /> : label}
    </div>
  );
}

/** Perfil: quadrado colorido com um rosto simples e a setinha de menu. */
function Profile({ active, onSelect }: { active: boolean; onSelect: () => void }) {
  const focus = useFocusable();
  return (
    <div
      {...focus}
      className={`topnav__profile${active ? ' is-active' : ''}`}
      aria-label="Configurações"
      onClick={onSelect}
    >
      <svg className="topnav__avatar" viewBox="0 0 40 40" aria-hidden="true">
        <rect width="40" height="40" rx="7" />
        <circle cx="13.5" cy="16" r="2.6" />
        <circle cx="26.5" cy="16" r="2.6" />
        <path d="M11 24.5q9 7 18 0" />
      </svg>
      <svg className="topnav__caret" viewBox="0 0 10 6" aria-hidden="true">
        <path d="M0 0h10L5 6z" />
      </svg>
    </div>
  );
}

export function TopNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const nav = useRef<HTMLElement>(null);
  const cameFrom = useRef<HTMLElement | null>(null);

  const known = TABS.some((t) => t.path === pathname) || pathname === SETTINGS;
  const activePath = known ? pathname : null;

  const backToContent = () => {
    if (!focusElement(cameFrom.current)) focusPageDefault();
  };

  useFocusMove(nav, (dir) => {
    if (dir !== 'down') return false;
    backToContent();
    return true;
  });

  const onFocus = (e: FocusEvent<HTMLElement>) => {
    const from = e.relatedTarget as HTMLElement | null;
    if (from && nav.current && !nav.current.contains(from)) cameFrom.current = from;
  };

  const select = (path: string) => {
    if (path === pathname) return backToContent();
    forgetPage(`#${path}`);
    cameFrom.current = null;
    navigate(path);
  };

  return (
    <header className={`topnav${pathname === '/' ? ' is-home' : ''}`}>
      <div className="topnav__shade" />
      <div className="topnav__brand display" aria-hidden="true">
        F
      </div>
      <nav
        ref={nav}
        className="topnav__bar"
        data-focus-group=""
        // a geometria não entra aqui (a fileira anterior, já rolada para cima,
        // ficaria mais longe que a barra); só pela borda: para cima sem nada
        // alinhado acima na página
        data-focus-enter="none"
        data-focus-edge="up"
        data-focus-lock="up"
        onFocus={onFocus}
      >
        <div className="topnav__tabs">
          {TABS.map((t) => (
            <Tab
              key={t.path}
              label={t.label}
              icon={t.icon}
              active={t.path === activePath}
              isDefault={t.path === (activePath ?? '/')}
              onSelect={() => select(t.path)}
            />
          ))}
        </div>
        <div className="topnav__start">
          <Profile active={activePath === SETTINGS} onSelect={() => select(SETTINGS)} />
        </div>
      </nav>
    </header>
  );
}
