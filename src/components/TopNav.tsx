import { useRef, type FocusEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { focusElement, focusPageDefault, forgetPage } from '../focus/FocusContext';
import { useFocusable, useFocusMove } from '../focus/useFocusable';
import { Icon, type IconName } from './Icon';

// Navegação no topo (experimental): marca à esquerda, abas no centro (busca,
// Início, Séries, Filmes, Minha lista) e Configurações à direita. A aba da
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
    <header className="topnav">
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
        <div className="topnav__end">
          <Tab
            label="Configurações"
            icon="settings"
            active={activePath === SETTINGS}
            isDefault={false}
            onSelect={() => select(SETTINGS)}
          />
        </div>
      </nav>
    </header>
  );
}
